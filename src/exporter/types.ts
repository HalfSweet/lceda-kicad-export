export interface LibraryRef {
	libraryUuid: string;
	uuid: string;
}

export interface Model3DRef {
	uuid: string;
	name?: string;
	libraryUuid?: string;
}

export type RefSource = 'sch' | 'pcb' | 'lcsc';

export interface NormalizedComponentRef {
	source: RefSource;
	device: LibraryRef;
	symbol?: LibraryRef;
	footprint?: LibraryRef;
	model3d?: Model3DRef;
	context?: {
		designator?: string;
		name?: string;
		lcscId?: string;
		supplierId?: string;
		footprintName?: string;
	};
}
