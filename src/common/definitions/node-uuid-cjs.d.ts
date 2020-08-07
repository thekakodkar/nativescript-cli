// Type definitions for node-uuid.js
// Project: https://github.com/broofa/node-uuid
// Definitions by: Jeff May <https://github.com/jeffmay>
// Definitions: https://github.com/borisyankov/DefinitelyTyped

/// <reference path="./node-uuid-base.d.ts" />

/**
 * Expose as CommonJS module
 * For use in node environment or browser environment (using webpack or other module loaders)
 */
declare module "uuid" {
	let uuid: __NodeUUID.UUID;
	export = uuid;
}
