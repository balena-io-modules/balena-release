import * as Bluebird from 'bluebird';
import * as _ from 'lodash';

import ApiClient = require('pinejs-client');
import { Composition } from 'resin-compose-parse';

import * as models from './models';
import { Dict } from './types';

const MAX_CONCURRENT_REQUESTS = 5;

export interface ClientConfig {
	/**
	 * The host address of the API server to use, complete with the protocol,
	 * eg. `https://api.balena-cloud.com`. This module will issue requests to v4 of
	 * the API.
	 */
	apiEndpoint: string;

	/**
	 * The complete string to forward as Authorization HTTP header, eg.
	 * `Bearer <authtoken>`.
	 */
	auth: string;
}

export function createClient(config: ClientConfig): ApiClient {
	return new ApiClient({
		apiPrefix: `${config.apiEndpoint}/v6/`,
		passthrough: {
			headers: {
				Authorization: config.auth,
			},
		},
	});
}

export interface Request {
	/**
	 * An instance of PineJS, appropriately authenticated and configured for the
	 * API server to use. The only compatible API version is v5, so make sure to
	 * configure `apiPrefix` appropriately.
	 *
	 * ```
	 * import Pine = require('pinejs-client');
	 * const client = new Pine({
	 *   apiPrefix: 'https://api.balena-cloud.com/v5',
	 *   passthrough: {
	 *     headers: {
	 *       Authorization: `Bearer ${authToken}`,
	 *     },
	 *   },
	 * });
	 * ```
	 *
	 * You can use the `createClient` convenience function of this module to create
	 * a client that can reused across requests.
	 */
	client: ApiClient;

	/**
	 * The ID of the user the release should belong to. The user authenticated via `client`
	 * (see above) must match or be a collaborator of `user` for the given `application`.
	 */
	user: number;

	/**
	 * The application ID this release is for. The client issuing the request
	 * must have read access to this application.
	 */
	application: number;

	/**
	 * The composition to deploy; it should be a normalised structure whose schema
	 * is defined in `resin-compose-parse`.
	 *
	 * See: https://github.com/balena-io-modules/resin-compose-parse
	 */
	composition: Composition;

	/**
	 * An identifier for the deploy's origin.
	 */
	source: string;

	/**
	 * The external identifier for the release.
	 */
	commit: string;
}

export interface Response {
	release: models.ReleaseModel;
	serviceImages: Dict<models.ImageModel>;
}

/**
 * This is the entry point for deploying a docker-compose.yml to devices.
 */
export async function create(req: Request): Promise<Response> {
	const api = req.client;

	// Ensure that the user and app exist and the user has access to them.
	const [user, application] = await Promise.all([
		getUser(api, req.user),
		getApplication(api, req.application),
	]);

	const release = await createRelease(api, {
		is_created_by__user: user.id,
		belongs_to__application: application.id,
		composition: req.composition,
		commit: req.commit,
		status: 'running',
		source: req.source,
		start_timestamp: new Date(),
	});

	const res = { release, serviceImages: {} } as Response;

	// Create services and associated image, labels and env vars
	await Bluebird.map(
		_.toPairs(req.composition.services),
		async ([serviceName, serviceDescription]) => {
			const service = await getOrCreateService(api, {
				application: application.id,
				service_name: serviceName,
			});

			// Create images and attach labels and env vars
			const img = await createImage(
				api,
				res.release.id,
				serviceDescription.labels,
				serviceDescription.environment,
				{
					is_a_build_of__service: service.id,
					status: 'running',
					start_timestamp: new Date(),
				},
			);

			// Amend response with image details for the service
			res.serviceImages[serviceName] = img;

			return service;
		},
		{
			concurrency: MAX_CONCURRENT_REQUESTS,
		},
	);

	return res;
}

export async function updateRelease(
	api: ApiClient,
	id: number,
	body: Partial<models.ReleaseAttributes>,
): Promise<models.ReleaseModel> {
	return models.update(api, 'release', id, body);
}

export async function updateImage(
	api: ApiClient,
	id: number,
	body: Partial<models.ImageAttributes>,
): Promise<models.ImageModel> {
	return models.update(api, 'image', id, body);
}

// Helpers

async function getUser(api: ApiClient, id: number): Promise<models.UserModel> {
	return models.get(api, 'user', id);
}

async function getApplication(
	api: ApiClient,
	id: number,
): Promise<models.ApplicationModel> {
	return models.get(api, 'application', id);
}

async function getOrCreateService(
	api: ApiClient,
	body: models.ServiceAttributes,
): Promise<models.ServiceModel> {
	return models.getOrCreate(api, 'service', body, {
		application: body.application,
		service_name: body.service_name,
	});
}

async function createRelease(
	api: ApiClient,
	body: models.ReleaseAttributes,
): Promise<models.ReleaseModel> {
	return models.create(api, 'release', body);
}

async function createImage(
	api: ApiClient,
	release: number,
	labels: Dict<string> | undefined,
	envvars: Dict<string> | undefined,
	body: models.ImageAttributes,
): Promise<models.ImageModel> {
	const image = await models.create<models.ImageModel, models.ImageAttributes>(
		api,
		'image',
		body,
	);

	const releaseImage = await models.create<
		models.ReleaseImageModel,
		models.ReleaseImageAttributes
	>(api, 'image__is_part_of__release', {
		is_part_of__release: release,
		image: image.id,
	});

	await Bluebird.map(
		_.toPairs(labels),
		([name, value]) => {
			return models.create(api, 'image_label', {
				release_image: releaseImage.id,
				label_name: name,
				value: (value || '').toString(),
			});
		},
		{
			concurrency: MAX_CONCURRENT_REQUESTS,
		},
	);

	await Bluebird.map(
		_.toPairs(envvars),
		([name, value]) => {
			return models.create(api, 'image_environment_variable', {
				release_image: releaseImage.id,
				name,
				value: (value || '').toString(),
			});
		},
		{
			concurrency: MAX_CONCURRENT_REQUESTS,
		},
	);

	return image;
}
