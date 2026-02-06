import JSZip from 'jszip';

export interface ZipFileEntry {
	path: string;
	data: string | Blob;
}

export async function buildZip(entries: ZipFileEntry[]): Promise<Blob> {
	const zip = new JSZip();
	for (const entry of entries) {
		zip.file(entry.path, entry.data);
	}
	return await zip.generateAsync({
		type: 'blob',
		compression: 'DEFLATE',
		compressionOptions: { level: 9 },
	});
}
