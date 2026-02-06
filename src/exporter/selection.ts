import type { NormalizedComponentRef } from './types';

const SCH_PRIMITIVE_COMPONENT = 'Component';
const SCH_COMPONENTTYPE_PART = 'part';
const PCB_PRIMITIVE_COMPONENT = 'Component';

function isLibraryRef(value: unknown): value is { libraryUuid: string; uuid: string } {
	return !!value
		&& typeof value === 'object'
		&& typeof (value as any).libraryUuid === 'string'
		&& typeof (value as any).uuid === 'string';
}

export async function getSelectedDevicesFromSch(): Promise<NormalizedComponentRef[]> {
	try {
		const selected = await eda.sch_SelectControl.getAllSelectedPrimitives();
		const out: NormalizedComponentRef[] = [];
		for (const primitive of selected) {
			if (primitive.getState_PrimitiveType() !== SCH_PRIMITIVE_COMPONENT) {
				continue;
			}
			const comp = primitive as any;
			if (typeof comp.getState_ComponentType === 'function') {
				const type = comp.getState_ComponentType();
				if (type !== SCH_COMPONENTTYPE_PART) {
					continue;
				}
			}

			const device = comp.getState_Component?.();
			if (!isLibraryRef(device)) {
				continue;
			}

			const symbol = comp.getState_Symbol?.();
			const footprint = comp.getState_Footprint?.();
			const designator = comp.getState_Designator?.();
			const name = comp.getState_Name?.();
			const supplierId = comp.getState_SupplierId?.();

			out.push({
				source: 'sch',
				device,
				symbol: isLibraryRef(symbol) ? symbol : undefined,
				footprint: isLibraryRef(footprint) ? footprint : undefined,
				context: {
					designator: typeof designator === 'string' ? designator : undefined,
					name: typeof name === 'string' ? name : undefined,
					supplierId: typeof supplierId === 'string' ? supplierId : undefined,
				},
			});
		}
		return out;
	}
	catch {
		return [];
	}
}

export async function getSelectedDevicesFromPcb(): Promise<NormalizedComponentRef[]> {
	try {
		const selected = await eda.pcb_SelectControl.getAllSelectedPrimitives();
		const out: NormalizedComponentRef[] = [];
		for (const primitive of selected) {
			if (primitive.getState_PrimitiveType() !== PCB_PRIMITIVE_COMPONENT) {
				continue;
			}
			const comp = primitive as any;

			const device = comp.getState_Component?.();
			if (!isLibraryRef(device)) {
				continue;
			}

			const footprint = comp.getState_Footprint?.();
			const model3d = comp.getState_Model3D?.();
			const designator = comp.getState_Designator?.();
			const name = comp.getState_Name?.();
			const supplierId = comp.getState_SupplierId?.();

			out.push({
				source: 'pcb',
				device,
				footprint: isLibraryRef(footprint) ? footprint : undefined,
				model3d: isLibraryRef(model3d) ? { uuid: model3d.uuid, libraryUuid: model3d.libraryUuid } : undefined,
				context: {
					designator: typeof designator === 'string' ? designator : undefined,
					name: typeof name === 'string' ? name : undefined,
					supplierId: typeof supplierId === 'string' ? supplierId : undefined,
				},
			});
		}
		return out;
	}
	catch {
		return [];
	}
}
