import type { EasyEDAComponentData } from '../vendor/jlcpcb-core/types';
import { KICAD_SYMBOL_VERSION } from '../vendor/jlcpcb-core/constants/kicad';
import { FootprintConverter, SymbolConverter } from '../vendor/jlcpcb-core/converter';
import { parseFootprintShapes, parseSymbolShapes } from '../vendor/jlcpcb-core/parsers';

const JSON_SHAPE_PREFIX = '__JSON__';

function toNumber(value: unknown, fallback = 0): number {
	const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
	return Number.isFinite(n) ? n : fallback;
}

function toStringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseJsonShapes(shape: string[]): { legacy: string[]; json: Record<string, unknown>[] } {
	const legacy: string[] = [];
	const json: Record<string, unknown>[] = [];

	for (const line of shape) {
		if (typeof line !== 'string') {
			continue;
		}
		if (line.startsWith(JSON_SHAPE_PREFIX)) {
			try {
				const parsed = JSON.parse(line.slice(JSON_SHAPE_PREFIX.length));
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					json.push(parsed as Record<string, unknown>);
					continue;
				}
			}
			catch {}
		}
		else if (line.startsWith('{')) {
			try {
				const parsed = JSON.parse(line);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					json.push(parsed as Record<string, unknown>);
					continue;
				}
			}
			catch {}
		}
		legacy.push(line);
	}

	return { legacy, json };
}

function parseSymbolShapesCompat(shape: string[]) {
	const { legacy, json } = parseJsonShapes(shape);
	const parsed = parseSymbolShapes(legacy);

	for (const obj of json) {
		const title = toStringValue(obj.title) ?? toStringValue(obj.text) ?? toStringValue(obj.name);
		if (title) {
			parsed.texts.push({
				x: toNumber(obj.x, toNumber(obj.centerX)),
				y: toNumber(obj.y, toNumber(obj.centerY)),
				rotation: toNumber(obj.rotation),
				fontSize: toNumber(obj.fontSize, 7),
				text: title,
				color: toStringValue(obj.color) ?? '#000000',
				textType: toStringValue(obj.type) ?? '',
				isPinPart: false,
				id: toStringValue(obj.id) ?? '',
			});
		}

		if (typeof obj.centerX === 'number' && typeof obj.centerY === 'number' && typeof obj.radius === 'number') {
			parsed.circles.push({
				cx: obj.centerX,
				cy: obj.centerY,
				radius: obj.radius,
				strokeWidth: toNumber(obj.strokeWidth, 1),
				strokeColor: toStringValue(obj.strokeColor) ?? '#000000',
				fillColor: toStringValue(obj.fillColor) ?? 'none',
			});
		}

		if (
			typeof obj.x === 'number'
			&& typeof obj.y === 'number'
			&& typeof obj.width === 'number'
			&& typeof obj.height === 'number'
		) {
			parsed.rectangles.push({
				x: obj.x,
				y: obj.y,
				rx: toNumber(obj.radiusX),
				ry: toNumber(obj.radiusY),
				width: obj.width,
				height: obj.height,
				strokeColor: toStringValue(obj.strokeColor) ?? '#000000',
				strokeWidth: toNumber(obj.strokeWidth, 1),
				fillColor: toStringValue(obj.fillColor) ?? 'none',
			});
		}

		const type = String(obj.type ?? '').toUpperCase();
		const hasPinHint = type === 'PART'
			|| type === 'PIN'
			|| typeof obj.pinNumber === 'string'
			|| typeof obj.number === 'string'
			|| (typeof obj.dotX1 === 'number' && typeof obj.dotX2 === 'number');

		if (hasPinHint) {
			const pinX = toNumber(obj.x, toNumber(obj.dotX1, toNumber(obj.centerX)));
			const pinY = toNumber(obj.y, toNumber(obj.dotY1, toNumber(obj.centerY)));
			const pinNumber = toStringValue(obj.pinNumber) ?? toStringValue(obj.number) ?? String(parsed.pins.length + 1);
			const pinName = toStringValue(obj.name) ?? toStringValue(obj.title) ?? pinNumber;
			const pinLength = Math.max(Math.abs(toNumber(obj.dotX2) - toNumber(obj.dotX1)), 100);

			if (!parsed.pins.find(pin => pin.number === pinNumber && pin.x === pinX && pin.y === pinY)) {
				parsed.pins.push({
					number: pinNumber,
					name: pinName,
					electricalType: '0',
					x: pinX,
					y: pinY,
					rotation: toNumber(obj.rotation),
					hasDot: Boolean(obj.hasDot || obj.inverted),
					hasClock: Boolean(obj.hasClock || obj.clock),
					pinLength,
				});
			}
		}
	}

	return parsed;
}

function parseFootprintShapesCompat(shape: string[]) {
	const { legacy, json } = parseJsonShapes(shape);
	const parsed = parseFootprintShapes(legacy);

	for (const obj of json) {
		const type = String(obj.type ?? '').toUpperCase();

		const hasPadHint = type === 'PAD'
			|| (
				typeof obj.centerX === 'number'
				&& typeof obj.centerY === 'number'
				&& typeof obj.width === 'number'
				&& typeof obj.height === 'number'
			);
		if (hasPadHint) {
			parsed.pads.push({
				shape: toStringValue(obj.shape) ?? 'RECT',
				centerX: toNumber(obj.centerX),
				centerY: toNumber(obj.centerY),
				width: toNumber(obj.width, 1),
				height: toNumber(obj.height, 1),
				layerId: Math.round(toNumber(obj.layerId, 1)),
				net: toStringValue(obj.net) ?? '',
				number: toStringValue(obj.number) ?? toStringValue(obj.padNumber) ?? String(parsed.pads.length + 1),
				holeRadius: toNumber(obj.holeRadius),
				points: toStringValue(obj.points) ?? '',
				rotation: toNumber(obj.rotation),
				id: toStringValue(obj.id) ?? '',
				holeLength: toNumber(obj.holeLength),
				holePoint: toStringValue(obj.holePoint) ?? '',
				isPlated: Boolean(obj.isPlated ?? toNumber(obj.holeRadius) > 0),
				isLocked: Boolean(obj.isLocked),
			});
			continue;
		}

		if (type === 'TRACK' && typeof obj.points === 'string') {
			parsed.tracks.push({
				strokeWidth: toNumber(obj.strokeWidth, 0.1),
				layerId: Math.round(toNumber(obj.layerId, 1)),
				net: toStringValue(obj.net) ?? '',
				points: obj.points,
				id: toStringValue(obj.id) ?? '',
				isLocked: Boolean(obj.isLocked),
			});
			continue;
		}

		if (type === 'HOLE' && typeof obj.centerX === 'number' && typeof obj.centerY === 'number') {
			parsed.holes.push({
				centerX: obj.centerX,
				centerY: obj.centerY,
				radius: toNumber(obj.radius, 0.1),
				id: toStringValue(obj.id) ?? '',
				isLocked: Boolean(obj.isLocked),
			});
			continue;
		}

		if (typeof obj.centerX === 'number' && typeof obj.centerY === 'number' && typeof obj.diameter === 'number') {
			parsed.vias.push({
				centerX: obj.centerX,
				centerY: obj.centerY,
				diameter: obj.diameter,
				net: toStringValue(obj.net) ?? '',
				radius: toNumber(obj.radius, obj.diameter / 2),
				id: toStringValue(obj.id) ?? '',
				isLocked: Boolean(obj.isLocked),
			});
			continue;
		}

		if (typeof obj.centerX === 'number' && typeof obj.centerY === 'number' && typeof obj.radius === 'number') {
			parsed.circles.push({
				cx: obj.centerX,
				cy: obj.centerY,
				radius: obj.radius,
				strokeWidth: toNumber(obj.strokeWidth, 0.1),
				layerId: Math.round(toNumber(obj.layerId, 21)),
				id: toStringValue(obj.id) ?? '',
				isLocked: Boolean(obj.isLocked),
			});
			continue;
		}

		if (typeof obj.path === 'string' && obj.path.trim()) {
			parsed.arcs.push({
				strokeWidth: toNumber(obj.strokeWidth, 0.1),
				layerId: Math.round(toNumber(obj.layerId, 21)),
				net: toStringValue(obj.net) ?? '',
				path: obj.path,
				helperDots: toStringValue(obj.helperDots) ?? '',
				id: toStringValue(obj.id) ?? '',
				isLocked: Boolean(obj.isLocked),
			});
			continue;
		}

		if (
			typeof obj.x === 'number'
			&& typeof obj.y === 'number'
			&& typeof obj.width === 'number'
			&& typeof obj.height === 'number'
		) {
			parsed.rects.push({
				x: obj.x,
				y: obj.y,
				width: obj.width,
				height: obj.height,
				strokeWidth: toNumber(obj.strokeWidth, 0.1),
				id: toStringValue(obj.id) ?? '',
				layerId: Math.round(toNumber(obj.layerId, 21)),
				isLocked: Boolean(obj.isLocked),
			});
			continue;
		}

		const text = toStringValue(obj.text) ?? toStringValue(obj.title);
		if (text) {
			parsed.texts.push({
				type: toStringValue(obj.textType) ?? '',
				centerX: toNumber(obj.x, toNumber(obj.centerX)),
				centerY: toNumber(obj.y, toNumber(obj.centerY)),
				strokeWidth: toNumber(obj.strokeWidth, 0.1),
				rotation: toNumber(obj.rotation),
				mirror: toStringValue(obj.mirror) ?? '',
				layerId: Math.round(toNumber(obj.layerId, 21)),
				net: toStringValue(obj.net) ?? '',
				fontSize: toNumber(obj.fontSize, 1),
				text,
				textPath: toStringValue(obj.textPath) ?? '',
				isDisplayed: Boolean(obj.isDisplayed ?? true),
				id: toStringValue(obj.id) ?? '',
				isLocked: Boolean(obj.isLocked),
			});
		}
	}

	return parsed;
}

export function getHeadNumber(head: any, key: string): number {
	const raw = head?.[key] ?? (key === 'x' ? head?.originX : key === 'y' ? head?.originY : undefined);
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

	const symbolParsed = parseSymbolShapesCompat(props.symbol.shape);
	const footprintParsed = parseFootprintShapesCompat(props.footprint.shape);

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
