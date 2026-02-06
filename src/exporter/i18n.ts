export function t(key: string, ...args: Array<string | number>): string {
	return eda.sys_I18n.text(key, undefined, undefined, ...args);
}
