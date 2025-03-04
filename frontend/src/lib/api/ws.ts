import io from 'socket.io-client';
import { wsHost } from './http';
import { browser, dev } from '$app/environment';
import { writable, derived, get } from 'svelte/store';
import { deleteDB, openDB } from 'idb';
import {
    type Action,
    emptyState,
    reduce,
    lists,
    users,
    picks,
    items,
    boosts,
    memberships,
    webPushSuscriptions
} from '@eligo/state';
import type { Error } from '@eligo/protocol';

export const state = writable(emptyState);

const socket = io(wsHost, {
    withCredentials: true,
    autoConnect: false,
    auth: {
        userId: browser ? window.localStorage.getItem('user.id') : null
    }
});

const connectedStore = writable(true);
export const connected = derived(connectedStore, (v) => v);

export const send = async (action: Action) =>
    new Promise<void>((resolve, reject) =>
        socket.emit(action.type, action.payload, (error: Error) => {
            if (error) {
                reject(new Error(error.message));
            } else {
                resolve();
            }
        })
    );

// debug logs for development
if (dev) {
    socket.onAny((event, ...args) => console.debug(event, args));
    socket.on('disconnect', () => console.debug('disconnected'));
    socket.on('connect', () => console.debug('connected'));
}

const eventTypes = [
    lists.created.type,
    lists.updated.type,
    lists.deleted.type,

    users.created.type,
    users.updated.type,
    users.deleted.type,

    picks.created.type,
    picks.updated.type,
    picks.deleted.type,

    items.created.type,
    items.updated.type,
    items.deleted.type,

    boosts.created.type,
    boosts.updated.type,
    boosts.deleted.type,

    memberships.created.type,
    memberships.updated.type,
    memberships.deleted.type,

    webPushSuscriptions.created.type,
    webPushSuscriptions.updated.type,
    webPushSuscriptions.deleted.type
];

type User = { id: string; name: string };

const getUserFromLocalStorage = () => {
    if (!browser) return undefined;
    const id = window.localStorage.getItem('user.id');
    const name = window.localStorage.getItem('user.name');
    return !!id && !!name ? { id, name } : undefined;
};

const saveUserToLocalStorage = (user: User) => {
    window.localStorage.setItem('user.id', user.id);
    window.localStorage.setItem('user.name', user.name);
};

const deleteUserFromLocalStorage = () => {
    if (!browser) return;
    window.localStorage.removeItem('user.id');
    window.localStorage.removeItem('user.name');
};

export const auth = writable<{ user?: User }>({
    user: getUserFromLocalStorage()
});

auth.subscribe(({ user }) => {
    if (user) {
        // keep user in the local storage
        saveUserToLocalStorage(user);
    } else {
        // cleanup user from the local storage if disconnected
        if (socket.connected) socket.disconnect();
        deleteUserFromLocalStorage();
    }
});

socket.on('connect', () => connectedStore.set(socket.connected));
socket.on('disconnect', () => connectedStore.set(socket.connected));
socket.on('connect_error', () => connectedStore.set(socket.connected));
socket.on('auth', () => connectedStore.set(socket.connected));
socket.on('auth', async (user: User) => auth.set({ user }));

export const connect = async () => {
    const user = get(auth).user;
    const isAuthenticated = !!user;
    if (!isAuthenticated) {
        socket.connect();
    } else {
        deleteDB('eligo');
        const db = await openDB('eligo.2', 1, {
            upgrade: (db) => db.createObjectStore(user.id)
        });
        socket.on('disconnect', () => db.close());

        // init state
        await db
            .getAll(user.id)
            .then((actions) => actions.reduce(reduce, emptyState))
            .then(state.set);

        const keys = await db.getAllKeys(user.id);
        const lastSynched = keys.reduce((max, key) => (key > max ? key : max), 0);

        socket.auth = {
            ...socket.auth,
            lastSynched
        };

        // save all new events to the store
        eventTypes.forEach((eventType) => {
            // subscribe to all events
            eventTypes.forEach((eventType) =>
                socket.on(eventType, (action) =>
                    state.update((state) => reduce(state, { type: eventType, payload: action }))
                )
            );

            socket.on(eventType, (action) =>
                db.put(
                    user.id,
                    { type: eventType, payload: action },
                    action.deleteTime ?? action.updateTime ?? action.createTime
                )
            );
        });

        socket.connect();
    }
};

connect();
