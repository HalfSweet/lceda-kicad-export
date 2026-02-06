export type LibraryDocumentType = '2' | '4'; // ELIB_LibraryType.SYMBOL | ELIB_LibraryType.FOOTPRINT

export const LIB_SYMBOL: LibraryDocumentType = '2';
export const LIB_FOOTPRINT: LibraryDocumentType = '4';

export async function openLibraryAndGetSource(
	libraryUuid: string,
	libraryType: LibraryDocumentType,
	uuid: string,
): Promise<string> {
	let tabId: string | undefined;
	try {
		tabId = await eda.dmt_EditorControl.openLibraryDocument(libraryUuid, libraryType as any, uuid);
		if (!tabId) {
			throw new Error('openLibraryDocument failed');
		}

		await eda.dmt_EditorControl.activateDocument(tabId);
		const source = await eda.sys_FileManager.getDocumentSource();
		if (!source) {
			throw new Error('getDocumentSource returned empty');
		}
		return source;
	}
	finally {
		if (tabId) {
			try {
				await eda.dmt_EditorControl.closeDocument(tabId);
			}
			catch {}
		}
	}
}

export interface ExtractedHeadAndShape {
	head: any;
	shape: string[];
}

function isHeadAndShapeCandidate(value: unknown): value is ExtractedHeadAndShape {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const v = value as any;
	if (!v.head || typeof v.head !== 'object') {
		return false;
	}
	if (!Array.isArray(v.shape)) {
		return false;
	}
	return v.shape.every((s: unknown) => typeof s === 'string');
}

function findHeadAndShape(value: unknown, depth: number): ExtractedHeadAndShape | undefined {
	if (isHeadAndShapeCandidate(value)) {
		return value;
	}
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	if (depth <= 0) {
		return undefined;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findHeadAndShape(item, depth - 1);
			if (found)
				return found;
		}
		return undefined;
	}

	for (const child of Object.values(value as Record<string, unknown>)) {
		const found = findHeadAndShape(child, depth - 1);
		if (found)
			return found;
	}
	return undefined;
}

export function extractHeadAndShape(documentSource: string): ExtractedHeadAndShape {
	let parsed: unknown;
	try {
		parsed = JSON.parse(documentSource);
	}
	catch {
		throw new Error('Document source is not valid JSON');
	}

	const found = findHeadAndShape(parsed, 6);
	if (!found) {
		throw new Error('Unable to find { head, shape[] } in document source');
	}
	return found;
}
