import type { EasyEDAComponentData } from '../vendor/jlcpcb-core/types';
import { KICAD_SYMBOL_VERSION } from '../vendor/jlcpcb-core/constants/kicad';
import { FootprintConverter, SymbolConverter } from '../vendor/jlcpcb-core/converter';
import { parseFootprintShapes, parseSymbolShapes } from '../vendor/jlcpcb-core/parsers';

export function getHeadNumber(head: any, key: string): number {
	const raw = head?.[key];
	const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? '0'));
	return Number.isFinite(n) ? n : 0;
}

export function getCParaString(head: any, key: string): string | undefined {
	const raw = head?.c_para?.[key];
	return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

export function buildEasyEdaComponentData(props: {
	info: {
		name: string;
		prefix: string;
		packageRef: string;
		lcscId?: string;
		manufacturer?: string;
		description?: string;
		datasheet?: string;
	};
	symbol: { head: any; shape: string[] };
	footprint: { head: any; shape: string[]; name: string };
	model3d?: { uuid: string; name?: string };
	rawData?: object;
}): EasyEDAComponentData {
	const symbolOrigin = {
		x: getHeadNumber(props.symbol.head, 'x'),
		y: getHeadNumber(props.symbol.head, 'y'),
	};
	const footprintOrigin = {
		x: getHeadNumber(props.footprint.head, 'x'),
		y: getHeadNumber(props.footprint.head, 'y'),
	};

	const symbolParsed = parseSymbolShapes(props.symbol.shape);
	const footprintParsed = parseFootprintShapes(props.footprint.shape);

	return {
		info: {
			name: props.info.name,
			prefix: props.info.prefix,
			package: props.info.packageRef,
			lcscId: props.info.lcscId,
			manufacturer: props.info.manufacturer,
			description: props.info.description,
			datasheet: props.info.datasheet,
		},
		symbol: {
			...symbolParsed,
			origin: symbolOrigin,
		},
		footprint: {
			...footprintParsed,
			name: props.footprint.name,
			origin: footprintOrigin,
		},
		model3d: props.model3d ? { uuid: props.model3d.uuid, name: props.model3d.name ?? '3D Model' } : footprintParsed.model3d,
		rawData: props.rawData ?? {},
	};
}

const symbolConverter = new SymbolConverter();
const footprintConverter = new FootprintConverter();

export function convertToSymbolEntry(component: EasyEDAComponentData, symbolName: string): string {
	return symbolConverter.convertToSymbolEntry(component, { symbolName });
}

export function convertToFootprintMod(
	component: EasyEDAComponentData,
	props: { include3DModel: boolean; modelPath?: string },
): string {
	return footprintConverter.convert(component, {
		include3DModel: props.include3DModel,
		modelPath: props.modelPath,
	});
}

export function wrapKiCadSymbolLibrary(entries: string[], props: { generator: string; generatorVersion: string }): string {
	const header = `(kicad_symbol_lib\n\t(version ${KICAD_SYMBOL_VERSION})\n\t(generator "${props.generator}")\n\t(generator_version "${props.generatorVersion}")\n`;
	return `${header + entries.join('')})\n`;
}
