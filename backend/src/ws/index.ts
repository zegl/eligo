import registerLists from './lists.js';
import registerUsers from './users.js';
import registerItems from './items.js';
import registerBoosts from './boosts.js';
import registerPicks from './picks.js';
import registerWebPushSubscriptions from './webPushSubscriptions.js';
import type { Server } from 'socket.io';
import type { Database } from '../db.js';
import { parse } from 'cookie';
import type { Tokens } from '../tokens.js';
import { boosts, items, lists, memberships, picks, users } from '@eligo/state';
import type { List, User } from '@eligo/protocol';
import { Notifications } from '../notifications.js';

type Middleware = Parameters<Server['use']>[0];

const authentication =
	(database: Database, tokens: Tokens): Middleware =>
	async (socket, next) => {
		if (!socket.handshake.headers.cookie) {
			next(new Error('unauthorized: token missing'));
			return;
		}
		const cookies = parse(socket.handshake.headers.cookie);
		const token = cookies['token'];
		try {
			const { payload } = await tokens.verify(token);
			if (!!socket.handshake.auth.userId && payload.sub !== socket.handshake.auth.userId) {
				next(new Error('unauthorized: invalid token'));
				return;
			}

			const user = await database.find('users', { id: payload.sub });
			if (!user) {
				next(new Error('user not found'));
			} else {
				socket.emit('auth', { id: user.id, name: user.name });
				socket.data.userId = user.id;
				next();
			}
		} catch {
			next(new Error('unauthorized: invalid token'));
			return;
		}
	};

const withUpdateTime = <
	T extends {
		deleteTime?: EpochTimeStamp;
		updateTime?: EpochTimeStamp;
		createTime: EpochTimeStamp;
	}
>(
	v: T
) => ({
	...v,
	updateTime: Math.max(v.deleteTime ?? 0, Math.max(v.updateTime ?? 0, v.createTime))
});

export default (io: Server, database: Database, tokens: Tokens, notifications: Notifications) => {
	io.use(authentication(database, tokens));

	io.on('connection', async (socket) => {
		socket.onAny((event, ...args) => console.log(JSON.stringify({ event, args })));

		const userId = socket.data.userId;
		const lastSynched = socket.handshake.auth.lastSynched || 0;

		const mms = await database.filter('memberships', { userId });
		const memberOf = (await Promise.all(
			mms.map(({ listId }) => database.find('lists', { id: listId }))
		).then((ll) => ll.filter((l) => !!l))) as List[];
		const owns = await database.filter('lists', { userId });
		const initLists = [...owns, ...memberOf];

		const initItems = await Promise.all(
			initLists.map(({ id }) => database.filter('items', { listId: id }))
		).then((ii) => ii.flatMap((i) => i));

		const initBoosts = await Promise.all(
			initLists.map(({ id }) => database.filter('boosts', { listId: id }))
		).then((bb) => bb.flatMap((b) => b));

		const initPicks = await Promise.all(
			initLists.map(({ id }) => database.filter('picks', { listId: id }))
		).then((pp) => pp.flatMap((p) => p));

		const memberWith = await Promise.all(
			initLists.map(({ id }) => database.filter('memberships', { listId: id }))
		).then((mm) => mm.flatMap((m) => m));

		const userIds = new Set<string>();
		userIds.add(userId);
		memberOf.forEach(({ userId }) => userIds.add(userId));
		initBoosts.forEach(({ userId }) => userIds.add(userId));
		initItems.forEach(({ userId }) => userIds.add(userId));
		memberWith.forEach(({ userId }) => userIds.add(userId));

		const initUsers = await Promise.all(
			Array.from(userIds.values()).map((id) => database.find('users', { id }))
		).then((uu) => uu.filter((u) => !!u) as User[]);

		const initActions = [
			...initLists.map((l) => lists.updated(withUpdateTime(l))),
			...initBoosts.map((b) => boosts.updated(withUpdateTime(b))),
			...initPicks.map((p) => picks.updated(withUpdateTime(p))),
			...initItems.map((i) => items.updated(withUpdateTime(i))),
			...initUsers.map((u) => users.updated(withUpdateTime(u))),
			...memberWith.map((m) => memberships.updated(withUpdateTime(m)))
		];

		socket.join(userId);

		// join all the channels
		initActions.forEach((action) => socket.join(action.payload.id));

		// only send new events
		initActions
			.filter((action) => action.payload.updateTime > lastSynched)
			.sort((a, b) => a.payload.updateTime - b.payload.updateTime) // ensure earlier events are sent first
			.forEach((action) => socket.emit(action.type, action.payload));

		registerUsers(io, socket, database);
		registerLists(io, socket, database);
		registerItems(io, socket, database, notifications);
		registerBoosts(io, socket, database, notifications);
		registerPicks(io, socket, database, notifications);
		registerWebPushSubscriptions(io, socket, database, notifications);
	});
};
