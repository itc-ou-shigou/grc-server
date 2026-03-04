/**
 * Unit tests for src/shared/middleware/error-handler.ts
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  asyncHandler,
} from '../../../src/shared/middleware/error-handler.js';
import type { Request, Response, NextFunction } from 'express';

// ── AppError base class ───────────────────────────────────────────────────────

describe('AppError', () => {
  it('constructs with correct statusCode, code, and message', () => {
    const err = new AppError(418, 'im_a_teapot', "I'm a teapot");
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('im_a_teapot');
    expect(err.message).toBe("I'm a teapot");
  });

  it('is an instance of Error', () => {
    const err = new AppError(500, 'internal_error', 'Something went wrong');
    expect(err).toBeInstanceOf(Error);
  });

  it('stores optional details', () => {
    const details = { field: 'email', issue: 'invalid format' };
    const err = new AppError(400, 'bad_request', 'Validation failed', details);
    expect(err.details).toEqual(details);
  });

  it('has name AppError', () => {
    const err = new AppError(400, 'bad_request', 'Bad');
    expect(err.name).toBe('AppError');
  });

  it('details is undefined when not provided', () => {
    const err = new AppError(404, 'not_found', 'Not found');
    expect(err.details).toBeUndefined();
  });
});

// ── BadRequestError ───────────────────────────────────────────────────────────

describe('BadRequestError', () => {
  it('has statusCode 400', () => {
    expect(new BadRequestError().statusCode).toBe(400);
  });

  it('has code bad_request', () => {
    expect(new BadRequestError().code).toBe('bad_request');
  });

  it('uses default message when none provided', () => {
    expect(new BadRequestError().message).toBe('Bad request');
  });

  it('accepts custom message', () => {
    expect(new BadRequestError('Invalid email').message).toBe('Invalid email');
  });

  it('accepts optional details', () => {
    const details = { field: 'email' };
    const err = new BadRequestError('Bad', details);
    expect(err.details).toEqual(details);
  });

  it('is an instance of AppError', () => {
    expect(new BadRequestError()).toBeInstanceOf(AppError);
  });
});

// ── UnauthorizedError ─────────────────────────────────────────────────────────

describe('UnauthorizedError', () => {
  it('has statusCode 401', () => {
    expect(new UnauthorizedError().statusCode).toBe(401);
  });

  it('has code unauthorized', () => {
    expect(new UnauthorizedError().code).toBe('unauthorized');
  });

  it('uses default message when none provided', () => {
    expect(new UnauthorizedError().message).toBe('Unauthorized');
  });

  it('accepts custom message', () => {
    expect(new UnauthorizedError('Token expired').message).toBe('Token expired');
  });

  it('is an instance of AppError', () => {
    expect(new UnauthorizedError()).toBeInstanceOf(AppError);
  });
});

// ── ForbiddenError ────────────────────────────────────────────────────────────

describe('ForbiddenError', () => {
  it('has statusCode 403', () => {
    expect(new ForbiddenError().statusCode).toBe(403);
  });

  it('has code forbidden', () => {
    expect(new ForbiddenError().code).toBe('forbidden');
  });

  it('uses default message when none provided', () => {
    expect(new ForbiddenError().message).toBe('Forbidden');
  });

  it('accepts custom message', () => {
    expect(new ForbiddenError('Access denied').message).toBe('Access denied');
  });

  it('is an instance of AppError', () => {
    expect(new ForbiddenError()).toBeInstanceOf(AppError);
  });
});

// ── NotFoundError ─────────────────────────────────────────────────────────────

describe('NotFoundError', () => {
  it('has statusCode 404', () => {
    expect(new NotFoundError().statusCode).toBe(404);
  });

  it('has code not_found', () => {
    expect(new NotFoundError().code).toBe('not_found');
  });

  it('uses default resource name Resource in message', () => {
    expect(new NotFoundError().message).toBe('Resource not found');
  });

  it('uses custom resource name in message', () => {
    expect(new NotFoundError('Skill').message).toBe('Skill not found');
  });

  it('is an instance of AppError', () => {
    expect(new NotFoundError()).toBeInstanceOf(AppError);
  });
});

// ── ConflictError ─────────────────────────────────────────────────────────────

describe('ConflictError', () => {
  it('has statusCode 409', () => {
    expect(new ConflictError().statusCode).toBe(409);
  });

  it('has code conflict', () => {
    expect(new ConflictError().code).toBe('conflict');
  });

  it('uses default message when none provided', () => {
    expect(new ConflictError().message).toBe('Resource already exists');
  });

  it('accepts custom message', () => {
    expect(new ConflictError('Username taken').message).toBe('Username taken');
  });

  it('is an instance of AppError', () => {
    expect(new ConflictError()).toBeInstanceOf(AppError);
  });
});

// ── asyncHandler ──────────────────────────────────────────────────────────────

describe('asyncHandler', () => {
  // Minimal mock helpers
  function makeReq(): Request {
    return {} as Request;
  }

  function makeRes(): Response {
    return {} as Response;
  }

  function makeNext(): NextFunction {
    return vi.fn() as unknown as NextFunction;
  }

  it('calls the wrapped handler function', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(req, res, next);
  });

  it('forwards promise rejection to next()', async () => {
    const error = new Error('Async failure');
    const handler = vi.fn().mockRejectedValue(error);
    const wrapped = asyncHandler(handler);
    const next = makeNext();

    await wrapped(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(error);
  });

  it('forwards AppError subclass rejections to next()', async () => {
    const appError = new NotFoundError('Gene');
    const handler = vi.fn().mockRejectedValue(appError);
    const wrapped = asyncHandler(handler);
    const next = makeNext();

    await wrapped(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledWith(appError);
  });

  it('does not call next() when handler resolves successfully', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    const wrapped = asyncHandler(handler);
    const next = makeNext();

    await wrapped(makeReq(), makeRes(), next);

    expect(next).not.toHaveBeenCalled();
  });

  it('returns a function that accepts (req, res, next)', () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);
    expect(typeof wrapped).toBe('function');
    expect(wrapped.length).toBe(3);
  });
});
