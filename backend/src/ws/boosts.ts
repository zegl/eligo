import { boosts } from '@eligo/state';
import type { Socket, Server } from 'socket.io';
import type { Database } from '../db.js';
import { Notifications } from '../notifications.js';

export default (io: Server, socket: Socket, database: Database, notifications: Notifications) => {
	socket.on(
		boosts.create.type,
		async (boost: ReturnType<typeof boosts.create>['payload'], callback) => {
			await database.append(boosts.create(boost));
			const created = boosts.created(boost);

			socket.join(created.payload.id);
			io.to([created.payload.id, created.payload.listId]).emit(created.type, created.payload);

			Promise.all([
				database.find('users', { id: boost.userId }),
				database.find('lists', { id: boost.listId }),
				database.find('items', { id: boost.itemId }),
				database.filter('memberships', { listId: boost.listId })
			]).then(([user, list, item, memberships]) => {
				if (!list) return;
				if (!user) return;
				if (!item) return;

				const membersIds = memberships.map(({ userId }) => userId);
				const userIds = [...membersIds, list.userId].filter((userId) => userId !== boost.userId);
				userIds.forEach((userId) =>
					notifications.notify(userId, {
						title: `New boost`,
						options: {
							body: `${user.name} boosted ${item.text} in ${list.title}`
						}
					})
				);
			});

			callback(null);
		}
	);
};
