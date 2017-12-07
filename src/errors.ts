import TypedError = require('typed-error');

export class ObjectDoesNotExistError extends TypedError {}
export class UnauthorisedError extends TypedError {}
export class BadRequestError extends TypedError {}
export class ServerError extends TypedError {}

export class HttpResponseError extends TypedError {
	public statusCode: number;

	constructor(message: string | Error, statusCode: number) {
		super(message);
		this.statusCode = statusCode;
	}
}
