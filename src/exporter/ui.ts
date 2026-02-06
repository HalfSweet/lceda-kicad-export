import { t } from './i18n';

export function showInfo(content: string, title: string = t('KiCad Export')): void {
	eda.sys_Dialog.showInformationMessage(content, title);
}

export function showError(content: string, title: string = t('KiCad Export')): void {
	eda.sys_Dialog.showInformationMessage(content, title);
}

export async function showInputText(props: {
	title?: string;
	beforeContent?: string;
	afterContent?: string;
	value?: string;
	placeholder?: string;
}): Promise<string | undefined> {
	return await new Promise((resolve) => {
		eda.sys_Dialog.showInputDialog(
			props.beforeContent,
			props.afterContent,
			props.title,
			'text',
			props.value ?? '',
			{ placeholder: props.placeholder },
			(value: unknown) => {
				if (typeof value === 'string') {
					resolve(value);
				}
				else {
					resolve(undefined);
				}
			},
		);
	});
}

export async function withProgressBar<T>(
	title: string,
	fn: (report: (progress: number, subtitle?: string) => void) => Promise<T>,
): Promise<T> {
	const report = (progress: number, subtitle?: string) => {
		const text = subtitle ? `${title} - ${subtitle}` : title;
		eda.sys_LoadingAndProgressBar.showProgressBar(progress, text);
	};

	try {
		report(0);
		const result = await fn(report);
		report(100);
		return result;
	}
	finally {
		eda.sys_LoadingAndProgressBar.destroyProgressBar();
	}
}
