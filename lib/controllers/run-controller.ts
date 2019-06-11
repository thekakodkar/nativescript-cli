import { HmrConstants, DeviceDiscoveryEventNames } from "../common/constants";
import { PREPARE_READY_EVENT_NAME, TrackActionNames, DEBUGGER_DETACHED_EVENT_NAME, RunOnDeviceEvents, USER_INTERACTION_NEEDED_EVENT_NAME } from "../constants";
import { cache, performanceLog } from "../common/decorators";
import { EventEmitter } from "events";

export class RunController extends EventEmitter implements IRunController {

	constructor(
		protected $analyticsService: IAnalyticsService,
		private $buildDataService: IBuildDataService,
		private $buildController: IBuildController,
		private $debugController: IDebugController,
		private $deviceInstallAppService: IDeviceInstallAppService,
		protected $devicesService: Mobile.IDevicesService,
		protected $errors: IErrors,
		protected $injector: IInjector,
		private $hmrStatusService: IHmrStatusService,
		public $hooksService: IHooksService,
		private $liveSyncServiceResolver: ILiveSyncServiceResolver,
		private $liveSyncProcessDataService: ILiveSyncProcessDataService,
		protected $logger: ILogger,
		protected $mobileHelper: Mobile.IMobileHelper,
		private $platformsDataService: IPlatformsDataService,
		private $pluginsService: IPluginsService,
		private $prepareController: IPrepareController,
		private $prepareDataService: IPrepareDataService,
		private $prepareNativePlatformService: IPrepareNativePlatformService,
		protected $projectDataService: IProjectDataService
	) {
		super();
	}

	public async run(runData: IRunData): Promise<void> {
		const { liveSyncInfo, deviceDescriptors } = runData;
		const { projectDir } = liveSyncInfo;

		const projectData = this.$projectDataService.getProjectData(projectDir);
		await this.initializeSetup(projectData);

		const platforms = this.$devicesService.getPlatformsFromDeviceDescriptors(deviceDescriptors);
		const deviceDescriptorsForInitialSync = this.getDeviceDescriptorsForInitialSync(projectDir, deviceDescriptors);

		this.$liveSyncProcessDataService.persistData(projectDir, deviceDescriptors, platforms);

		const shouldStartWatcher = !liveSyncInfo.skipWatcher && this.$liveSyncProcessDataService.hasDeviceDescriptors(projectDir);
		if (shouldStartWatcher && liveSyncInfo.useHotModuleReload) {
			this.$hmrStatusService.attachToHmrStatusEvent();
		}

		this.$prepareController.on(PREPARE_READY_EVENT_NAME, async data => {
			await this.syncChangedDataOnDevices(data, projectData, liveSyncInfo, deviceDescriptors);
		});

		await this.syncInitialDataOnDevices(projectData, liveSyncInfo, deviceDescriptorsForInitialSync);

		this.attachDeviceLostHandler();
	}

	public async stop(data: IStopRunData): Promise<void> {
		const { projectDir, deviceIdentifiers, stopOptions } = data;
		const liveSyncProcessInfo = this.$liveSyncProcessDataService.getPersistedData(projectDir);
		if (liveSyncProcessInfo && !liveSyncProcessInfo.isStopped) {
			// In case we are coming from error during livesync, the current action is the one that erred (but we are still executing it),
			// so we cannot await it as this will cause infinite loop.
			const shouldAwaitPendingOperation = !stopOptions || stopOptions.shouldAwaitAllActions;

			const deviceIdentifiersToRemove = deviceIdentifiers || _.map(liveSyncProcessInfo.deviceDescriptors, d => d.identifier);

			const removedDeviceIdentifiers = _.remove(liveSyncProcessInfo.deviceDescriptors, descriptor => _.includes(deviceIdentifiersToRemove, descriptor.identifier))
				.map(descriptor => descriptor.identifier);

			// Handle the case when no more devices left for any of the persisted platforms
			_.each(liveSyncProcessInfo.platforms, platform => {
				const devices = this.$devicesService.getDevicesForPlatform(platform);
				if (!devices || !devices.length) {
					this.$prepareController.stopWatchers(projectDir, platform);
				}
			});

			// In case deviceIdentifiers are not passed, we should stop the whole LiveSync.
			if (!deviceIdentifiers || !deviceIdentifiers.length || !liveSyncProcessInfo.deviceDescriptors || !liveSyncProcessInfo.deviceDescriptors.length) {
				if (liveSyncProcessInfo.timer) {
					clearTimeout(liveSyncProcessInfo.timer);
				}

				_.each(liveSyncProcessInfo.platforms, platform => {
					this.$prepareController.stopWatchers(projectDir, platform);
				});

				liveSyncProcessInfo.isStopped = true;

				if (liveSyncProcessInfo.actionsChain && shouldAwaitPendingOperation) {
					await liveSyncProcessInfo.actionsChain;
				}

				liveSyncProcessInfo.deviceDescriptors = [];

				const projectData = this.$projectDataService.getProjectData(projectDir);
				await this.$hooksService.executeAfterHooks('watch', {
					hookArgs: {
						projectData
					}
				});
			} else if (liveSyncProcessInfo.currentSyncAction && shouldAwaitPendingOperation) {
				await liveSyncProcessInfo.currentSyncAction;
			}

			// Emit RunOnDevice stopped when we've really stopped.
			_.each(removedDeviceIdentifiers, deviceIdentifier => {
				this.emitCore(RunOnDeviceEvents.runOnDeviceStopped, {
					projectDir,
					deviceIdentifier
				});
			});
		}
	}

	public getDeviceDescriptors(data: { projectDir: string }): ILiveSyncDeviceDescriptor[] {
		return this.$liveSyncProcessDataService.getDeviceDescriptors(data.projectDir);
	}

	protected async refreshApplication(projectData: IProjectData, liveSyncResultInfo: ILiveSyncResultInfo, filesChangeEventData: IFilesChangeEventData, deviceDescriptor: ILiveSyncDeviceDescriptor, settings?: IRefreshApplicationSettings): Promise<IRestartApplicationInfo> {
		const result = deviceDescriptor.debuggingEnabled ?
			await this.refreshApplicationWithDebug(projectData, liveSyncResultInfo, filesChangeEventData, deviceDescriptor, settings) :
			await this.refreshApplicationWithoutDebug(projectData, liveSyncResultInfo, filesChangeEventData, deviceDescriptor, settings);

		return result;
	}

	protected async refreshApplicationWithDebug(projectData: IProjectData, liveSyncResultInfo: ILiveSyncResultInfo, filesChangeEventData: IFilesChangeEventData, deviceDescriptor: ILiveSyncDeviceDescriptor, settings?: IRefreshApplicationSettings): Promise<IRestartApplicationInfo> {
		const debugOptions = deviceDescriptor.debugOptions || {};

		liveSyncResultInfo.waitForDebugger = !!debugOptions.debugBrk;

		const refreshInfo = await this.refreshApplicationWithoutDebug(projectData, liveSyncResultInfo, filesChangeEventData, deviceDescriptor, settings);

		// we do not stop the application when debugBrk is false, so we need to attach, instead of launch
		// if we try to send the launch request, the debugger port will not be printed and the command will timeout
		debugOptions.start = !debugOptions.debugBrk;
		debugOptions.forceDebuggerAttachedEvent = refreshInfo.didRestart;

		await this.$debugController.enableDebuggingCoreWithoutWaitingCurrentAction(projectData.projectDir, deviceDescriptor.identifier, debugOptions);

		return refreshInfo;
	}

	@performanceLog()
	protected async refreshApplicationWithoutDebug(projectData: IProjectData, liveSyncResultInfo: ILiveSyncResultInfo, filesChangeEventData: IFilesChangeEventData, deviceDescriptor: ILiveSyncDeviceDescriptor, settings?: IRefreshApplicationSettings): Promise<IRestartApplicationInfo> {
		const result = { didRestart: false };
		const platform = liveSyncResultInfo.deviceAppData.platform;
		const applicationIdentifier = projectData.projectIdentifiers[platform.toLowerCase()];
		const platformLiveSyncService = this.$liveSyncServiceResolver.resolveLiveSyncService(platform);

		try {
			let shouldRestart = filesChangeEventData && filesChangeEventData.hasNativeChanges;
			if (!shouldRestart) {
				shouldRestart = await platformLiveSyncService.shouldRestart(projectData, liveSyncResultInfo);
			}

			if (!shouldRestart) {
				shouldRestart = !await platformLiveSyncService.tryRefreshApplication(projectData, liveSyncResultInfo);
			}

			if (shouldRestart) {
				this.emit(DEBUGGER_DETACHED_EVENT_NAME, { deviceIdentifier: liveSyncResultInfo.deviceAppData.device.deviceInfo.identifier });
				await platformLiveSyncService.restartApplication(projectData, liveSyncResultInfo);
				result.didRestart = true;
			}
		} catch (err) {
			this.$logger.info(`Error while trying to start application ${applicationIdentifier} on device ${liveSyncResultInfo.deviceAppData.device.deviceInfo.identifier}. Error is: ${err.message || err}`);
			const msg = `Unable to start application ${applicationIdentifier} on device ${liveSyncResultInfo.deviceAppData.device.deviceInfo.identifier}. Try starting it manually.`;
			this.$logger.warn(msg);

			const device = liveSyncResultInfo.deviceAppData.device;
			const deviceIdentifier = device.deviceInfo.identifier;

			if (!settings || !settings.shouldSkipEmitLiveSyncNotification) {
				this.emitCore(RunOnDeviceEvents.runOnDeviceNotification, {
					projectDir: projectData.projectDir,
					deviceIdentifier: device.deviceInfo.identifier,
					applicationIdentifier: projectData.projectIdentifiers[device.deviceInfo.platform.toLowerCase()],
					notification: msg
				});
			}

			if (settings && settings.shouldCheckDeveloperDiscImage && (err.message || err) === "Could not find developer disk image") {
				const attachDebuggerOptions: IAttachDebuggerData = {
					platform: device.deviceInfo.platform,
					isEmulator: device.isEmulator,
					projectDir: projectData.projectDir,
					deviceIdentifier,
					debugOptions: deviceDescriptor.debugOptions,
					outputPath: deviceDescriptor.outputPath
				};
				this.emit(USER_INTERACTION_NEEDED_EVENT_NAME, attachDebuggerOptions);
			}
		}

		return result;
	}

	private getDeviceDescriptorsForInitialSync(projectDir: string, deviceDescriptors: ILiveSyncDeviceDescriptor[]) {
		const currentRunData = this.$liveSyncProcessDataService.getPersistedData(projectDir);
		const isAlreadyLiveSyncing = currentRunData && !currentRunData.isStopped;
		// Prevent cases where liveSync is called consecutive times with the same device, for example [ A, B, C ] and then [ A, B, D ] - we want to execute initialSync only for D.
		const deviceDescriptorsForInitialSync = isAlreadyLiveSyncing ? _.differenceBy(deviceDescriptors, currentRunData.deviceDescriptors, "identifier") : deviceDescriptors;

		return deviceDescriptorsForInitialSync;
	}

	private async initializeSetup(projectData: IProjectData): Promise<void> {
		try {
			await this.$pluginsService.ensureAllDependenciesAreInstalled(projectData);
		} catch (err) {
			this.$logger.trace(err);
			this.$errors.failWithoutHelp(`Unable to install dependencies. Make sure your package.json is valid and all dependencies are correct. Error is: ${err.message}`);
		}
	}

	@cache()
	private attachDeviceLostHandler(): void {
		this.$devicesService.on(DeviceDiscoveryEventNames.DEVICE_LOST, async (device: Mobile.IDevice) => {
			this.$logger.trace(`Received ${DeviceDiscoveryEventNames.DEVICE_LOST} event in LiveSync service for ${device.deviceInfo.identifier}. Will stop LiveSync operation for this device.`);

			for (const projectDir in this.$liveSyncProcessDataService.getAllPersistedData()) {
				try {
					const deviceDescriptors = this.getDeviceDescriptors({ projectDir });
					if (_.find(deviceDescriptors, d => d.identifier === device.deviceInfo.identifier)) {
						await this.stop({ projectDir, deviceIdentifiers: [device.deviceInfo.identifier] });
					}
				} catch (err) {
					this.$logger.warn(`Unable to stop LiveSync operation for ${device.deviceInfo.identifier}.`, err);
				}
			}
		});
	}

	private async syncInitialDataOnDevices(projectData: IProjectData, liveSyncInfo: ILiveSyncInfo, deviceDescriptors: ILiveSyncDeviceDescriptor[]): Promise<void> {
		const deviceAction = async (device: Mobile.IDevice) => {
			const deviceDescriptor = _.find(deviceDescriptors, dd => dd.identifier === device.deviceInfo.identifier);
			const platformData = this.$platformsDataService.getPlatformData(device.deviceInfo.platform, projectData);
			const prepareData = this.$prepareDataService.getPrepareData(liveSyncInfo.projectDir, device.deviceInfo.platform, { ...liveSyncInfo, watch: !liveSyncInfo.skipWatcher, nativePrepare: { skipNativePrepare: !!deviceDescriptor.skipNativePrepare } });
			const buildData = this.$buildDataService.getBuildData(projectData.projectDir, device.deviceInfo.platform, { ...liveSyncInfo, outputPath: deviceDescriptor.outputPath, buildForDevice: !device.isEmulator });
			const prepareResultData = await this.$prepareController.prepare(prepareData);

			try {
				let packageFilePath: string = null;
				const shouldBuild = prepareResultData.hasNativeChanges || await this.$buildController.shouldBuild(buildData);
				if (shouldBuild) {
					packageFilePath = await deviceDescriptor.buildAction();
				} else {
					await this.$analyticsService.trackEventActionInGoogleAnalytics({
						action: TrackActionNames.LiveSync,
						device,
						projectDir: projectData.projectDir
					});
				}

				await this.$deviceInstallAppService.installOnDeviceIfNeeded(device, buildData, packageFilePath);

				const platformLiveSyncService = this.$liveSyncServiceResolver.resolveLiveSyncService(platformData.platformNameLowerCase);
				const { force, useHotModuleReload, skipWatcher } = liveSyncInfo;
				const liveSyncResultInfo = await platformLiveSyncService.fullSync({ force, useHotModuleReload, projectData, device, watch: !skipWatcher, liveSyncDeviceData: deviceDescriptor });

				await this.refreshApplication(projectData, liveSyncResultInfo, null, deviceDescriptor);

				this.emitCore(RunOnDeviceEvents.runOnDeviceExecuted, {
					projectDir: projectData.projectDir,
					deviceIdentifier: device.deviceInfo.identifier,
					applicationIdentifier: projectData.projectIdentifiers[device.deviceInfo.platform.toLowerCase()],
					syncedFiles: liveSyncResultInfo.modifiedFilesData.map(m => m.getLocalPath()),
					isFullSync: liveSyncResultInfo.isFullSync
				});

				this.$logger.info(`Successfully synced application ${liveSyncResultInfo.deviceAppData.appIdentifier} on device ${liveSyncResultInfo.deviceAppData.device.deviceInfo.identifier}.`);

				this.emitCore(RunOnDeviceEvents.runOnDeviceStarted, {
					projectDir: projectData.projectDir,
					deviceIdentifier: device.deviceInfo.identifier,
					applicationIdentifier: projectData.projectIdentifiers[device.deviceInfo.platform.toLowerCase()]
				});
			} catch (err) {
				this.$logger.warn(`Unable to apply changes on device: ${device.deviceInfo.identifier}. Error is: ${err.message}.`);

				this.emitCore(RunOnDeviceEvents.runOnDeviceError, {
					projectDir: projectData.projectDir,
					deviceIdentifier: device.deviceInfo.identifier,
					applicationIdentifier: projectData.projectIdentifiers[device.deviceInfo.platform.toLowerCase()],
					error: err,
				});
			}
		};

		await this.addActionToChain(projectData.projectDir, () => this.$devicesService.execute(deviceAction, (device: Mobile.IDevice) => _.some(deviceDescriptors, deviceDescriptor => deviceDescriptor.identifier === device.deviceInfo.identifier)));
	}

	private async syncChangedDataOnDevices(data: IFilesChangeEventData, projectData: IProjectData, liveSyncInfo: ILiveSyncInfo, deviceDescriptors: ILiveSyncDeviceDescriptor[]): Promise<void> {
		const deviceAction = async (device: Mobile.IDevice) => {
			const deviceDescriptor = _.find(deviceDescriptors, dd => dd.identifier === device.deviceInfo.identifier);
			const platformData = this.$platformsDataService.getPlatformData(data.platform, projectData);
			const prepareData = this.$prepareDataService.getPrepareData(projectData.projectDir, data.platform, { ...liveSyncInfo, watch: !liveSyncInfo.skipWatcher });

			try {
				if (data.hasNativeChanges) {
					if (await this.$prepareNativePlatformService.prepareNativePlatform(platformData, projectData, prepareData)) {
						await deviceDescriptor.buildAction();
					}
				}

				const isInHMRMode = liveSyncInfo.useHotModuleReload && data.hmrData && data.hmrData.hash;
				if (isInHMRMode) {
					this.$hmrStatusService.watchHmrStatus(device.deviceInfo.identifier, data.hmrData.hash);
				}

				const platformLiveSyncService = this.$liveSyncServiceResolver.resolveLiveSyncService(device.deviceInfo.platform);
				const watchInfo = {
					liveSyncDeviceData: deviceDescriptor,
					projectData,
					filesToRemove: <any>[],
					filesToSync: data.files,
					isReinstalled: false,
					hmrData: data.hmrData,
					useHotModuleReload: liveSyncInfo.useHotModuleReload,
					force: liveSyncInfo.force,
					connectTimeout: 1000
				};
				let liveSyncResultInfo = await platformLiveSyncService.liveSyncWatchAction(device, watchInfo);

				await this.refreshApplication(projectData, liveSyncResultInfo, data, deviceDescriptor);

				this.emitCore(RunOnDeviceEvents.runOnDeviceExecuted, {
					projectDir: projectData.projectDir,
					deviceIdentifier: device.deviceInfo.identifier,
					applicationIdentifier: projectData.projectIdentifiers[device.deviceInfo.platform.toLowerCase()],
					syncedFiles: liveSyncResultInfo.modifiedFilesData.map(m => m.getLocalPath()),
					isFullSync: liveSyncResultInfo.isFullSync
				});

				if (!liveSyncResultInfo.didRecover && isInHMRMode) {
					const status = await this.$hmrStatusService.getHmrStatus(device.deviceInfo.identifier, data.hmrData.hash);
					if (status === HmrConstants.HMR_ERROR_STATUS) {
						watchInfo.filesToSync = data.hmrData.fallbackFiles;
						liveSyncResultInfo = await platformLiveSyncService.liveSyncWatchAction(device, watchInfo);
						// We want to force a restart of the application.
						liveSyncResultInfo.isFullSync = true;
						await this.refreshApplication(projectData, liveSyncResultInfo, data, deviceDescriptor);

						this.emitCore(RunOnDeviceEvents.runOnDeviceExecuted, {
							projectDir: projectData.projectDir,
							deviceIdentifier: device.deviceInfo.identifier,
							applicationIdentifier: projectData.projectIdentifiers[device.deviceInfo.platform.toLowerCase()],
							syncedFiles: liveSyncResultInfo.modifiedFilesData.map(m => m.getLocalPath()),
							isFullSync: liveSyncResultInfo.isFullSync
						});
					}
				}

				this.$logger.info(`Successfully synced application ${liveSyncResultInfo.deviceAppData.appIdentifier} on device ${liveSyncResultInfo.deviceAppData.device.deviceInfo.identifier}.`);
			} catch (err) {
				const allErrors = (<Mobile.IDevicesOperationError>err).allErrors;

				if (allErrors && _.isArray(allErrors)) {
					for (const deviceError of allErrors) {
						this.$logger.warn(`Unable to apply changes for device: ${deviceError.deviceIdentifier}. Error is: ${deviceError.message}.`);

						this.emitCore(RunOnDeviceEvents.runOnDeviceError, {
							projectDir: projectData.projectDir,
							deviceIdentifier: device.deviceInfo.identifier,
							applicationIdentifier: projectData.projectIdentifiers[device.deviceInfo.platform.toLowerCase()],
							error: err,
						});
					}
				}
			}
		};

		await this.addActionToChain(projectData.projectDir, () => this.$devicesService.execute(deviceAction, (device: Mobile.IDevice) => {
			const liveSyncProcessInfo = this.$liveSyncProcessDataService.getPersistedData(projectData.projectDir);
			return (data.platform.toLowerCase() === device.deviceInfo.platform.toLowerCase()) && liveSyncProcessInfo && _.some(liveSyncProcessInfo.deviceDescriptors, deviceDescriptor => deviceDescriptor.identifier === device.deviceInfo.identifier);
		}));
	}

	private async addActionToChain<T>(projectDir: string, action: () => Promise<T>): Promise<T> {
		const liveSyncInfo = this.$liveSyncProcessDataService.getPersistedData(projectDir);
		if (liveSyncInfo) {
			liveSyncInfo.actionsChain = liveSyncInfo.actionsChain.then(async () => {
				if (!liveSyncInfo.isStopped) {
					liveSyncInfo.currentSyncAction = action();
					const res = await liveSyncInfo.currentSyncAction;
					return res;
				}
			});

			const result = await liveSyncInfo.actionsChain;
			return result;
		}
	}

	private emitCore(event: string, data: ILiveSyncEventData): void {
		this.$logger.trace(`Will emit event ${event} with data`, data);
		this.emit(event, data);
	}
}
$injector.register("runController", RunController);