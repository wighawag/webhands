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

export type {Hand, HandContext, HandContribution} from './hand-host.js';

export {
	readHandsConfig,
	normalizeConfig,
	loadHands,
	HandLoadError,
	HANDS_CONFIG_FILENAME,
	type HandEntry,
	type HandsConfig,
	type LoadedHand,
	type LoadHandsOptions,
} from './hand-loading.js';

export {PlaywrightLaunchTransport} from './playwright-launch-transport.js';

export {PlaywrightAttachTransport} from './playwright-attach-transport.js';

export {
	setupProfile,
	buildPrompt,
	type PromptSink,
	type SetupProfileOptions,
	type SetupProfileResult,
} from './setup-profile.js';

export {
	ControllerError,
	MissingBrowserBinaryError,
	MissingProfileError,
	AttachNotChromiumError,
	AttachNoContextError,
	NoLiveServerError,
	SessionAlreadyActiveError,
	isControllerError,
	type ControllerErrorCode,
} from './errors.js';

export {
	resolveSessionEndpointPath,
	writeSessionEndpoint,
	readSessionEndpoint,
	clearSessionEndpoint,
	SESSION_ENDPOINT_FILENAME,
	type SessionEndpoint,
} from './session-endpoint.js';

export {
	startSessionServer,
	sessionAlreadyActive,
	type SessionServerOptions,
	type RunningSessionServer,
} from './session-server.js';

export {connectRemoteSession} from './remote-session.js';

export {
	SESSION_RPC_PATH,
	applySessionRpc,
	makeRpcPage,
	type SessionRpcRequest,
	type SessionRpcResponse,
} from './session-rpc.js';

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
