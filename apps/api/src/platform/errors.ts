import { ERROR_STATUS, type ErrorBody, type ErrorCode } from '@c2a/contracts';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Array<{ path: string; code: string; message: string }>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toErrorBody(
  err: unknown,
  requestId: string,
): { status: number; body: ErrorBody; headers?: Record<string, string> } {
  if (err instanceof AppError) {
    return {
      status: ERROR_STATUS[err.code],
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
          request_id: requestId,
        },
      },
      ...(err.headers ? { headers: err.headers } : {}),
    };
  }
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid.',
          details: err.issues.map((i) => ({
            path: i.path.join('.'),
            code: i.code,
            message: i.message,
          })),
          request_id: requestId,
        },
      },
    };
  }
  const fe = err as FastifyError;
  if (typeof fe?.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    const code: ErrorCode =
      fe.statusCode === 404
        ? 'NOT_FOUND'
        : fe.statusCode === 413
          ? 'PAYLOAD_TOO_LARGE'
          : fe.statusCode === 415
            ? 'UNSUPPORTED_MEDIA_TYPE'
            : 'BAD_REQUEST';
    return {
      status: ERROR_STATUS[code],
      body: {
        error: { code, message: 'The request could not be processed.', request_id: requestId },
      },
    };
  }
  // Unknown errors never leak internals (SEC-17); details go to the log only.
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
        request_id: requestId,
      },
    },
  };
}

export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply): void {
  const { status, body, headers } = toErrorBody(err, req.id);
  if (status >= 500) req.log.error({ err }, 'unhandled error');
  if (headers) for (const [k, v] of Object.entries(headers)) void reply.header(k, v);
  void reply.status(status).send(body);
}
