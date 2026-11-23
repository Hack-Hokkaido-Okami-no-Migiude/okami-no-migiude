import type { InjectionKey, Ref } from 'vue';

const draftRegistry: InjectionKey<Set<Readonly<Ref<boolean>>>> =
	Symbol('workbench-drafts');

export function useDraftProtection() {
	const drafts = new Set<Readonly<Ref<boolean>>>();
	provide(draftRegistry, drafts);
	const isDirty = () => [...drafts].some((draft) => draft.value);
	const beforeUnload = (event: BeforeUnloadEvent) => {
		if (!isDirty()) {
			return;
		}
		event.preventDefault();
		event.returnValue = true;
	};
	onMounted(() => window.addEventListener('beforeunload', beforeUnload));
	onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload));
	return {
		hasUnsavedEdits: isDirty,
		confirmLeaving: () =>
			!isDirty()
			|| window.confirm('Discard unsaved edits and switch interviews?'),
	};
}

export function registerWorkbenchDraft(dirty: Readonly<Ref<boolean>>) {
	const drafts = inject(draftRegistry);
	drafts?.add(dirty);
	onUnmounted(() => drafts?.delete(dirty));
}
