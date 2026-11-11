import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bodyContainsSecret, captureOutboundRequest } from "../src/outbound-request.ts";

const expected = { endpoint: "https://example.invalid/v1/messages", model: "synthetic-model" };
const body = '{ "model": "synthetic-model", "messages": [{"content":"示例"}] }';

test("captures the final UTF-8 body byte-for-byte and excludes authorization headers", () => {
  const snapshot = captureOutboundRequest(expected.endpoint, {
    method: "POST", body, headers: { authorization: "synthetic-secret" },
  }, expected);
  assert.equal(snapshot.body, body);
  assert.equal(snapshot.bodySha256, createHash("sha256").update(Buffer.from(body)).digest("hex"));
  assert.equal(JSON.stringify(snapshot).includes("synthetic-secret"), false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.notEqual(snapshot.bodySha256, captureOutboundRequest(expected.endpoint, { method: "POST", body: JSON.stringify(JSON.parse(body)) }, expected).bodySha256);
});

test("fails closed for changed endpoint, model, method or opaque body", () => {
  assert.throws(() => captureOutboundRequest("https://example.invalid/other", { method: "POST", body }, expected));
  assert.throws(() => captureOutboundRequest(expected.endpoint, { method: "POST", body: '{"model":"other"}' }, expected));
  assert.throws(() => captureOutboundRequest(expected.endpoint, { method: "GET", body }, expected));
  assert.throws(() => captureOutboundRequest(expected.endpoint, { method: "POST", body: new Blob([body]) }, expected));
  assert.throws(() => captureOutboundRequest(new Request(expected.endpoint, { method: "POST", body }), undefined, expected));
  assert.throws(() => captureOutboundRequest(expected.endpoint, { method: "POST", body: "{" }, expected));
});

test("credential scan catches both literal and JSON-escaped secrets", () => {
  assert.equal(bodyContainsSecret('{"message":"prefix-se\\u0063ret-suffix"}', ["secret"]), true);
  assert.equal(bodyContainsSecret('{"message":"secret"}', ["secret"]), true);
  assert.equal(bodyContainsSecret('{"message":"safe"}', ["secret"]), false);
  assert.equal(bodyContainsSecret("{", ["secret"]), true);
});
