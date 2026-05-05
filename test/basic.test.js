'use strict';

const { ShoonyaClient, ShoonyaApiError } = require('../src/index');
const assert = require('assert');

// Module exports
assert(typeof ShoonyaClient === 'function', 'ShoonyaClient should be a class');
assert(typeof ShoonyaApiError === 'function', 'ShoonyaApiError should be a class');

// Checksum generation
const checksum = ShoonyaClient.generateChecksum('ABC', '123', 'x1y2z3');
// SHA-256 of "ABC123x1y2z3"
const expected = require('crypto').createHash('sha256').update('ABC123x1y2z3').digest('hex');
assert.strictEqual(checksum, expected, 'generateChecksum mismatch');

// Client instantiation and session management
const client = new ShoonyaClient();
assert.deepStrictEqual(client.getSession(), { accessToken: null, uid: null, actid: null });

client.setSession({ accessToken: 'tok123', uid: 'USER1', actid: 'ACC1' });
assert.deepStrictEqual(client.getSession(), { accessToken: 'tok123', uid: 'USER1', actid: 'ACC1' });

// Custom base URL
const c2 = new ShoonyaClient({ baseUrl: 'https://custom.example.com/api/' });
assert.strictEqual(c2._base, 'https://custom.example.com/api', 'trailing slash should be stripped');

// ShoonyaApiError is an Error subclass
const err = new ShoonyaApiError('test error', { stat: 'Not_Ok' });
assert(err instanceof Error);
assert.strictEqual(err.name, 'ShoonyaApiError');
assert.strictEqual(err.message, 'test error');
assert.deepStrictEqual(err.response, { stat: 'Not_Ok' });

console.log('All tests passed.');
