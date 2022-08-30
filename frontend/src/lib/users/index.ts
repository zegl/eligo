export { default as Single } from './Single.svelte';

import { useSync, useFilter } from '$lib/logux';
import { syncMapTemplate } from '@logux/client';
import type { Filter, FilterOptions } from '@logux/client';
import type { User } from '@eligo/protocol';

const store = syncMapTemplate<User>('users', {
    offline: true
});

export const useUsers = (filter?: Filter<User>, opts?: FilterOptions) =>
	useFilter<User>(store, filter, opts);

export const useUser = (id: string) => useSync(store, id);
