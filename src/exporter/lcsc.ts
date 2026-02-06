import type { NormalizedComponentRef } from './types';
import { t } from './i18n';
import { showInputText } from './ui';
import { extractLcscIds, normalizeLcscId } from './utils';

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

export async function fetchDevicesByLcscIds(ids: string[]): Promise<NormalizedComponentRef[]> {
	if (ids.length === 0)
		return [];

	const items = await eda.lib_Device.getByLcscIds(ids);
	const list = Array.isArray(items) ? items : [];

	const out: NormalizedComponentRef[] = [];
	for (let i = 0; i < list.length; i++) {
		const item = list[i] as any;
		const device = { libraryUuid: item.libraryUuid, uuid: item.uuid };
		if (!isLibraryRef(device))
			continue;

		const symbol = item.symbol;
		const footprint = item.footprint;
		const model3d = item.model3D;

		out.push({
			source: 'lcsc',
			device,
			symbol: isLibraryRef(symbol) ? symbol : undefined,
			footprint: isLibraryRef(footprint) ? footprint : undefined,
			model3d: isLibraryRef(model3d) ? { uuid: model3d.uuid, name: model3d.name, libraryUuid: model3d.libraryUuid } : undefined,
			context: {
				name: typeof item.name === 'string' ? item.name : undefined,
				lcscId: ids[i] ?? undefined,
				supplierId: typeof item.supplierId === 'string' ? item.supplierId : undefined,
				footprintName: typeof footprint?.name === 'string' ? footprint.name : undefined,
			},
		});
	}

	return out;
}
