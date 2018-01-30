import * as Promise from 'bluebird';

import ApiClient = require('pinejs-client');
import { Expand, Filter, ODataOptions } from 'pinejs-client/core';
import * as compose from 'resin-compose-parse';

import * as errors from './errors';

// These interfaces declare all model attributes except relations.

interface ServiceAttributesBase {
	service_name: string;
}

interface ReleaseAttributesBase {
	composition: compose.Composition;
	commit: string;
	status: string;
	source: string;
	start_timestamp: Date;
	end_timestamp?: Date;
}

interface ReleaseImageAttributesBase {
	// empty
}

interface ImageAttributesBase {
	start_timestamp: Date;
	end_timestamp?: Date;
	dockerfile?: string;
	image_size?: number;
	project_type?: string;
	error_message?: string;
	build_log?: string;
	push_timestamp?: Date;
	status: string;
	content_hash?: string;
}

// These interfaces are to be used when updating the db.

export interface ServiceAttributes extends ServiceAttributesBase {
	application: number;
}

export interface ReleaseAttributes extends ReleaseAttributesBase {
	is_created_by__user: number;
	belongs_to__application: number;
}

export interface ImageAttributes extends ImageAttributesBase {
	is_a_build_of__service: number;
}

export interface ReleaseImageAttributes extends ReleaseImageAttributesBase {
	is_part_of__release: number;
	image: number;
}

// These interfaces are to be used when fetching from db.

export interface UserModel {
	id: number;
}

export interface ApplicationModel {
	id: number;
}

export interface ServiceModel extends ServiceAttributesBase {
	id: number;
}

export interface ReleaseModel extends ReleaseAttributesBase {
	id: number;
}

export interface ImageModel extends ImageAttributesBase {
	id: number;

	// this is set automatically by the API and the only
	// way to access its value is to fetch it.
	is_stored_at__image_location: string;
}

export interface ReleaseImageModel extends ReleaseImageAttributesBase {
	id: number;
}

// Helpers

export function getOrCreate<T, U, V extends Filter>(api: ApiClient, resource: string, body: U, filter: V): Promise<T> {
	return create(api, resource, body).catch(errors.ObjectDoesNotExistError, (_e) => {
		return find(api, resource, { $filter: filter }).then((obj: T[]) => {
			if (obj.length > 0) {
				return obj[0];
			}
			throw new errors.ObjectDoesNotExistError();
		});
	}) as Promise<T>;
}

export function create<T, U>(api: ApiClient, resource: string, body: U): Promise<T> {
	return api.post({ resource, body }).catch(wrapResponseError) as Promise<T>;
}

export function update<T, U>(api: ApiClient, resource: string, id: number, body: U): Promise<T> {
	return api.patch({ resource, id, body }).catch(wrapResponseError) as Promise<T>;
}

export function find<T>(api: ApiClient, resource: string, options: ODataOptions): Promise<T[]> {
	return api.get({ resource, options }).catch(wrapResponseError) as Promise<T[]>;
}

export function get<T>(api: ApiClient, resource: string, id: number, expand?: Expand): Promise<T> {
	let options: any;
	if (expand) {
		options = { $expand: expand };
	}
	return api.get({ resource, id, options }).catch(wrapResponseError) as Promise<T>;
}

function wrapResponseError<E extends Error>(e: E): void {
	const error: { statusCode?: number } = e as any;
	if (!error.statusCode) {
		throw e;
	}
	switch (error.statusCode) {
	case 400:
		throw new errors.BadRequestError(e);
	case 401:
		throw new errors.UnauthorisedError(e);
	case 404:
		throw new errors.ObjectDoesNotExistError(e);
	case 500:
		throw new errors.ServerError(e);
	default:
		throw new errors.HttpResponseError(e, error.statusCode);
	}
}
