import type { NormalizedComponentRef } from './types';
import { t } from './i18n';
import { logWarn, showInputText } from './ui';
import { extractLcscIds, isLcscId, normalizeLcscId } from './utils';

export async function promptLcscIds(): Promise<string[] | undefined> {
	const input = await showInputText({
		title: t('Export by LCSC ID'),
		beforeContent: t('Enter LCSC IDs'),
		placeholder: 'C8734, C2040 ...',
	});

	if (input === undefined)
		return undefined;
	const ids = extractLcscIds(input).map(normalizeLcscId);
	return ids;
}

function isLibraryRef(value: unknown): value is { libraryUuid: string; uuid: string } {
	return !!value
		&& typeof value === 'object'
		&& typeof (value as any).libraryUuid === 'string'
		&& typeof (value as any).uuid === 'string';
}

function getItemLcscId(item: any): string | undefined {
	const raw = typeof item?.supplierId === 'string' ? item.supplierId : undefined;
	if (!raw || !isLcscId(raw)) {
		return undefined;
	}
	return normalizeLcscId(raw);
}

function toNormalizedRef(item: any, lcscId?: string): NormalizedComponentRef | undefined {
	const device = { libraryUuid: item?.libraryUuid, uuid: item?.uuid };
	if (!isLibraryRef(device))
		return undefined;

	const symbol = item?.symbol;
	const footprint = item?.footprint;
	const model3d = item?.model3D;

	return {
		source: 'lcsc',
		device,
		symbol: isLibraryRef(symbol) ? symbol : undefined,
		footprint: isLibraryRef(footprint) ? footprint : undefined,
		model3d: isLibraryRef(model3d) ? { uuid: model3d.uuid, name: model3d.name, libraryUuid: model3d.libraryUuid } : undefined,
		context: {
			name: typeof item?.name === 'string' ? item.name : undefined,
			lcscId,
			supplierId: typeof item?.supplierId === 'string' ? item.supplierId : undefined,
			footprintName: typeof footprint?.name === 'string' ? footprint.name : undefined,
		},
	};
}

async function searchDeviceByLcscId(id: string): Promise<any | undefined> {
	try {
		const result = await eda.lib_Device.search(id);
		const list = Array.isArray(result) ? result : [];
		const exactBySupplier = list.find((item: any) => {
			const sid = typeof item?.supplierId === 'string' ? normalizeLcscId(item.supplierId) : undefined;
			return sid === id;
		});
		if (exactBySupplier) {
			return exactBySupplier;
		}
		return list.find((item: any) => {
			return typeof item?.name === 'string' && item.name.toUpperCase().includes(id);
		});
	}
	catch {
		return undefined;
	}
}

export async function fetchDevicesByLcscIds(ids: string[]): Promise<NormalizedComponentRef[]> {
	if (ids.length === 0)
		return [];

	const normalizedIds = ids.map(normalizeLcscId);
	const idSet = new Set(normalizedIds);
	const matched = new Map<string, any>();
	let list: any[] = [];

	try {
		const items = await eda.lib_Device.getByLcscIds(normalizedIds, undefined, true);
		list = Array.isArray(items) ? items : [];
	}
	catch (err) {
		logWarn(`getByLcscIds failed, fallback to search: ${String(err)}`);
	}

	for (const item of list) {
		const lcscId = getItemLcscId(item);
		if (!lcscId || !idSet.has(lcscId) || matched.has(lcscId)) {
			continue;
		}
		matched.set(lcscId, item);
	}

	for (const id of normalizedIds) {
		if (matched.has(id)) {
			continue;
		}
		const fallback = await searchDeviceByLcscId(id);
		if (fallback) {
			matched.set(id, fallback);
			logWarn(`Fallback search matched LCSC ID: ${id}`);
		}
		else {
			logWarn(`No device matched LCSC ID: ${id}`);
		}
	}

	const out: NormalizedComponentRef[] = [];
	for (const id of normalizedIds) {
		const item = matched.get(id);
		if (!item) {
			continue;
		}
		const ref = toNormalizedRef(item, id);
		if (ref) {
			out.push(ref);
		}
	}

	return out;
}
