import type { FastifyRequest } from 'fastify';
import { AppError } from './errors';

/** The app registers a string body parser for application/json; this parses it with a clean 400 on bad JSON. */
export function readJson(req: FastifyRequest): unknown {
  if (typeof req.body !== 'string' || req.body === '') return {};
  try {
    return JSON.parse(req.body);
  } catch {
    throw new AppError('BAD_REQUEST', 'The request body is not valid JSON.');
  }
}

/** Ids are BIGINT strings: digits only, up to 20 characters. */
export function bigintId(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{1,20}$/.test(v)) {
    throw new AppError('NOT_FOUND', 'Not found.');
  }
  return v;
}
