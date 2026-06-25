export type {
	Cookie,
	Driver,
	LocatorString,
	OpenTarget,
	Page,
	Session,
	Snapshot,
	SnapshotOptions,
	SnapshotView,
	Transport,
	WaitCondition,
} from './seam.js';
export {locator} from './seam.js';

export {
	serializeCookies,
	deserializeCookies,
	COOKIES_EXPORT_VERSION,
	type CookiesExport,
} from './cookies-export.js';

export {StubTransport, type StubCall} from './stub-transport.js';

export {PlaywrightLaunchTransport} from './playwright-launch-transport.js';

export {PlaywrightAttachTransport} from './playwright-attach-transport.js';

export {
	ControllerError,
	MissingBrowserBinaryError,
	MissingProfileError,
	AttachNotChromiumError,
	AttachNoContextError,
	isControllerError,
	type ControllerErrorCode,
} from './errors.js';

export {
	resolveHomeRoot,
	resolveProfileLocation,
	CONTROLLER_HOME_ENV,
	DEFAULT_HOME_DIRNAME,
	PROFILES_DIRNAME,
	type ProfileLocation,
	type ProfileLocationOptions,
} from './profile-location.js';

export {
	startFixtureServer,
	type FixtureServer,
} from './test-fixtures/fixture-server.js';
export {FIXTURE_PAGES} from './test-fixtures/fixture-pages.js';
