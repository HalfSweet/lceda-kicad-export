import type { ExtractedHeadAndShape } from './librarySource';
import type { LibraryRef, NormalizedComponentRef } from './types';
import type { ZipFileEntry } from './zip';
import * as extensionConfig from '../../extension.json';
import { buildEasyEdaComponentData, convertToFootprintMod, convertToSymbolEntry, getCParaString, wrapKiCadSymbolLibrary } from './convert';
import { t } from './i18n';
import { fetchDevicesByLcscIds, promptLcscIds } from './lcsc';
import { extractHeadAndShape, LIB_FOOTPRINT, LIB_SYMBOL, openLibraryAndGetSource } from './librarySource';
import { getSelectedDevicesFromPcb, getSelectedDevicesFromSch } from './selection';
import { logError, logWarn, showError, showInfo, withProgressBar } from './ui';

import { extractPrefix, formatTimestampForFile, isLcscId, sanitizeFileName, sanitizeName, shortenUuid } from './utils';
import { buildZip } from './zip';

interface EnrichedDevice {
	ref: NormalizedComponentRef;
	device: LibraryRef;
	deviceName: string;
	prefix: string;
	description?: string;
	manufacturer?: string;
	lcscId?: string;
	symbol: LibraryRef;
	footprint: LibraryRef;
	footprintNameHint?: string;
	model3d?: { uuid: string; name?: string };
}

function keyOf(ref: LibraryRef): string {
	return `${ref.libraryUuid}:${ref.uuid}`;
}

function uniqueName(base: string, used: Set<string>): string {
	let name = base;
	let i = 2;
	while (used.has(name)) {
		name = `${base}_${i++}`;
	}
	used.add(name);
	return name;
}

async function safeGetDeviceItem(device: LibraryRef): Promise<any | undefined> {
	try {
		return await eda.lib_Device.get(device.uuid, device.libraryUuid);
	}
	catch {
		return undefined;
	}
}

function parseLcscIdCandidate(...values: Array<string | undefined>): string | undefined {
	for (const v of values) {
		if (v && isLcscId(v))
			return v.toUpperCase();
	}
	return undefined;
}

async function enrichRefs(refs: NormalizedComponentRef[], report: (p: number, s?: string) => void): Promise<{ devices: EnrichedDevice[]; failures: string[] }> {
	const failures: string[] = [];
	const devices: EnrichedDevice[] = [];

	const unique = new Map<string, NormalizedComponentRef>();
	for (const ref of refs) {
		unique.set(keyOf(ref.device), ref);
	}

	const list = [...unique.values()];
	for (let i = 0; i < list.length; i++) {
		const ref = list[i];
		report(10 + Math.floor((i / Math.max(1, list.length)) * 10), `Resolve (${i + 1}/${list.length})`);

		const deviceItem = await safeGetDeviceItem(ref.device);

		const deviceName = deviceItem?.name ?? ref.context?.name ?? ref.device.uuid;
		const description = deviceItem?.description;
		const manufacturer = deviceItem?.property?.manufacturer;
		const designator = ref.context?.designator ?? deviceItem?.property?.designator;
		const prefix = extractPrefix(designator);

		const lcscId = parseLcscIdCandidate(
			ref.context?.lcscId,
			ref.context?.supplierId,
			deviceItem?.property?.supplierId,
		);

		const symbol: LibraryRef | undefined = ref.symbol
			?? (deviceItem?.association?.symbol
				? { uuid: deviceItem.association.symbol.uuid, libraryUuid: deviceItem.association.symbol.libraryUuid }
				: undefined);
		const footprint: LibraryRef | undefined = ref.footprint
			?? (deviceItem?.association?.footprint
				? { uuid: deviceItem.association.footprint.uuid, libraryUuid: deviceItem.association.footprint.libraryUuid }
				: undefined);

		if (!symbol || !footprint) {
			failures.push(`${deviceName}: missing ${!symbol ? 'symbol' : ''}${(!symbol && !footprint) ? ' & ' : ''}${!footprint ? 'footprint' : ''}`);
			continue;
		}

		const model3d = ref.model3d ? { uuid: ref.model3d.uuid, name: ref.model3d.name } : undefined;

		devices.push({
			ref,
			device: ref.device,
			deviceName,
			prefix,
			description: typeof description === 'string' ? description : undefined,
			manufacturer: typeof manufacturer === 'string' ? manufacturer : undefined,
			lcscId,
			symbol,
			footprint,
			footprintNameHint: ref.context?.footprintName,
			model3d,
		});
	}

	return { devices, failures };
}

async function getLibraryDocCached(
	cache: Map<string, ExtractedHeadAndShape>,
	ref: LibraryRef,
	type: typeof LIB_SYMBOL | typeof LIB_FOOTPRINT,
): Promise<ExtractedHeadAndShape> {
	const cacheKey = `${type}:${keyOf(ref)}`;
	const cached = cache.get(cacheKey);
	if (cached)
		return cached;
	const source = await openLibraryAndGetSource(ref.libraryUuid, type, ref.uuid);
	let extracted: ExtractedHeadAndShape;
	try {
		extracted = extractHeadAndShape(source);
	}
	catch (err) {
		const kind = type === LIB_SYMBOL ? 'symbol' : 'footprint';
		const reason = err instanceof Error ? err.message : String(err);
		throw new Error(`Parse ${kind} source failed (${ref.libraryUuid}/${ref.uuid}): ${reason}`);
	}
	cache.set(cacheKey, extracted);
	return extracted;
}

function buildReadme(baseName: string): string {
	return [
		'KiCad Import Instructions',
		`1) Unzip into your KiCad project folder (recommended).`,
		`2) Symbol library: Preferences -> Manage Symbol Libraries -> Add Existing Library -> choose "${baseName}.kicad_sym"`,
		`   Set the library nickname to: ${baseName}`,
		`3) Footprint library: Preferences -> Manage Footprint Libraries -> Add Existing Library -> choose "${baseName}.pretty"`,
		`   Set the library nickname to: ${baseName}`,
		'4) 3D models (if present) are referenced as:',
		`   \${KIPRJMOD}/${baseName}.3dshapes/*.step`,
		'',
		'注意 / Notes',
		`- 符号中的 Footprint 字段按 "${baseName}:<footprint>" 生成，因此封装库昵称必须为 "${baseName}"。`,
		'- 如果未启用扩展“外部交互”权限或处于离线模式，将跳过 3D 下载，但符号/封装仍会导出。',
	].join('\n');
}

function isExternalInteractionError(err: unknown): boolean {
	const msg = String(err ?? '');
	return msg.includes('外部交互') || msg.toLowerCase().includes('external interaction') || msg.toLowerCase().includes('permission');
}

function errorToMessage(err: unknown): string {
	if (err instanceof Error) {
		if (err.stack) {
			return err.stack;
		}
		return err.message;
	}
	return String(err);
}

function compactError(err: unknown): string {
	const firstLine = errorToMessage(err).split('\n')[0]?.trim();
	return firstLine || 'Unknown error';
}

function formatFailureDetails(failures: string[]): string {
	if (failures.length === 0) {
		return '';
	}
	const shown = failures.slice(0, 5);
	const lines = shown.map((item, index) => `${index + 1}. ${item}`);
	if (failures.length > shown.length) {
		lines.push(`...and ${failures.length - shown.length} more`);
	}
	return lines.join('\n');
}

async function downloadStepModel(
	uuid: string,
): Promise<Blob> {
	const url = `https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/${uuid}`;
	const response = await eda.sys_ClientUrl.request(url, 'GET');
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return await response.blob();
}

export async function exportRefsToKiCadZip(refs: NormalizedComponentRef[]): Promise<void> {
	try {
		await withProgressBar(t('KiCad Export'), async (report) => {
			report(0, 'Prepare');

			const { devices, failures: resolveFailures } = await enrichRefs(refs, report);
			if (devices.length === 0) {
				const detail = formatFailureDetails(resolveFailures);
				showError(detail ? `${t('Export failed')}\n${detail}` : t('No components selected'));
				if (detail) {
					eda.sys_Log.export(['warn', 'error', 'fatalError']);
				}
				return;
			}

			const now = new Date();
			const baseName = devices.length === 1
				? sanitizeFileName(`${devices[0].deviceName}_${devices[0].lcscId ?? shortenUuid(devices[0].device.uuid)}`)
				: sanitizeFileName(`LCEDA_Export_${formatTimestampForFile(now)}`);

			const usedSymbolNames = new Set<string>();
			const usedFootprintNames = new Set<string>();
			const symbolEntries: string[] = [];
			const zipEntries: ZipFileEntry[] = [];

			const docCache = new Map<string, ExtractedHeadAndShape>();
			const stepCache = new Map<string, { blob?: Blob; fileName?: string; failed?: boolean }>();

			const offline = eda.sys_Environment.isOfflineMode();
			let externalInteractionBlocked = false;
			let no3dCount = 0;
			let exportedCount = 0;
			const exportFailures: string[] = [...resolveFailures];

			if (offline) {
				logWarn(t('Offline mode, skip 3D'));
			}

			for (let i = 0; i < devices.length; i++) {
				const d = devices[i];
				report(20 + Math.floor((i / Math.max(1, devices.length)) * 60), `Convert (${i + 1}/${devices.length})`);

				try {
					const symbolDoc = await getLibraryDocCached(docCache, d.symbol, LIB_SYMBOL);
					const footprintDoc = await getLibraryDocCached(docCache, d.footprint, LIB_FOOTPRINT);

					const idPart = d.lcscId ?? shortenUuid(d.device.uuid);
					const symbolName = uniqueName(sanitizeName(`${d.deviceName}_${idPart}`), usedSymbolNames);

					const footprintHint = d.footprintNameHint
						?? getCParaString(footprintDoc.head, 'package')
						?? getCParaString(footprintDoc.head, 'name')
						?? `Footprint_${shortenUuid(d.footprint.uuid)}`;
					const footprintName = uniqueName(sanitizeName(`${footprintHint}_${idPart}`), usedFootprintNames);

					const modelUuid = d.model3d?.uuid;
					const modelName = d.model3d?.name ?? footprintHint;
					let stepBlob: Blob | undefined;
					let stepFileName: string | undefined;

					if (!offline && modelUuid && !externalInteractionBlocked) {
						const cached = stepCache.get(modelUuid);
						if (cached?.blob && cached.fileName) {
							stepBlob = cached.blob;
							stepFileName = cached.fileName;
						}
						else if (!cached?.failed) {
							try {
								stepBlob = await downloadStepModel(modelUuid);
								stepFileName = sanitizeFileName(`${modelName}_${shortenUuid(modelUuid)}.step`);
								stepCache.set(modelUuid, { blob: stepBlob, fileName: stepFileName });
							}
							catch (err) {
								stepCache.set(modelUuid, { failed: true });
								if (isExternalInteractionError(err)) {
									externalInteractionBlocked = true;
								}
								logWarn(`3D STEP download failed (${modelUuid}): ${compactError(err)}`);
							}
						}
					}

					if (!stepBlob)
						no3dCount++;

					const componentData = buildEasyEdaComponentData({
						info: {
							name: d.deviceName,
							prefix: d.prefix,
							packageRef: `${baseName}:${footprintName}`,
							lcscId: d.lcscId,
							manufacturer: d.manufacturer,
							description: d.description,
						},
						symbol: symbolDoc,
						footprint: { ...footprintDoc, name: footprintName },
						model3d: modelUuid ? { uuid: modelUuid, name: modelName } : undefined,
					});

					const symbolEntry = convertToSymbolEntry(componentData, symbolName);
					symbolEntries.push(symbolEntry);

					const modelPath = stepBlob && stepFileName
						? `\${KIPRJMOD}/${baseName}.3dshapes/${stepFileName}`
						: undefined;
					const footprintMod = convertToFootprintMod(componentData, {
						include3DModel: !!(stepBlob && stepFileName),
						modelPath,
					});

					zipEntries.push({
						path: `${baseName}.pretty/${footprintName}.kicad_mod`,
						data: `${footprintMod}\n`,
					});

					if (stepBlob && stepFileName) {
						zipEntries.push({
							path: `${baseName}.3dshapes/${stepFileName}`,
							data: stepBlob,
						});
					}

					exportedCount++;
				}
				catch (err) {
					const concise = compactError(err);
					exportFailures.push(`${d.deviceName}: ${concise}`);
					logError(`Export failed (${d.device.uuid}): ${errorToMessage(err)}`);
				}
			}

			if (symbolEntries.length === 0) {
				const detail = formatFailureDetails(exportFailures);
				showError(detail ? `${t('Export failed')}\n${detail}` : t('Export failed'));
				eda.sys_Log.export(['warn', 'error', 'fatalError']);
				return;
			}

			report(85, 'Package');

			const symbolLib = wrapKiCadSymbolLibrary(symbolEntries, {
				generator: 'lceda-kicad-export',
				generatorVersion: extensionConfig.version,
			});

			zipEntries.push({ path: `${baseName}.kicad_sym`, data: symbolLib });
			zipEntries.push({ path: 'README.txt', data: buildReadme(baseName) });

			const zipBlob = await buildZip(zipEntries);
			report(95, 'Download');
			await eda.sys_FileSystem.saveFile(zipBlob, `${baseName}.zip`);

			if (externalInteractionBlocked) {
				showInfo(t('3D requires external interaction'));
			}

			showInfo(
				t('Export summary', exportedCount, exportFailures.length, no3dCount),
				t('Export finished'),
			);
		});
	}
	catch (err) {
		logError(`Fatal export error: ${errorToMessage(err)}`);
		showError(`${t('Export failed')}\n${compactError(err)}`);
		eda.sys_Log.export(['warn', 'error', 'fatalError']);
	}
}

export async function exportSelectedToKiCad(): Promise<void> {
	const [sch, pcb] = await Promise.all([
		getSelectedDevicesFromSch(),
		getSelectedDevicesFromPcb(),
	]);
	const refs = [...sch, ...pcb];
	if (refs.length === 0) {
		showInfo(t('No components selected'));
		return;
	}
	await exportRefsToKiCadZip(refs);
}

export async function exportByLcscToKiCad(): Promise<void> {
	const ids = await promptLcscIds();
	if (!ids)
		return;
	if (ids.length === 0) {
		showInfo(t('No valid LCSC IDs'));
		return;
	}

	const refs = await fetchDevicesByLcscIds(ids);
	if (refs.length === 0) {
		logWarn(`No device matched LCSC IDs: ${ids.join(', ')}`);
		showError(`${t('Export failed')}\nLCSC IDs: ${ids.join(', ')}`);
		return;
	}
	await exportRefsToKiCadZip(refs);
}
