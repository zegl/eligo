import {
	addSyncMap,
	addSyncMapFilter,
	BaseServer,
	ChangedAt,
	Context,
	NoConflictResolution,
	SyncMapData
} from '@logux/server';
import { defineSyncMapActions, LoguxNotFoundError } from '@logux/actions';
import type { List } from '@eligo/protocol';

import { ListRecord, Lists, Memberships } from '../db/index.js';

const modelName = 'lists';

const [createAction, changeAction, deleteAction, _createdAction, _changedAction, _deletedAction] =
	defineSyncMapActions<List>(modelName);

const toSyncMapValue = (list: ListRecord): SyncMapData<List> => ({
	id: list.id,
	title: ChangedAt(list.title, list.titleChangeTime),
	userId: NoConflictResolution(list.userId),
	createTime: NoConflictResolution(list.createTime),
	invitatationId: ChangedAt(list.invitatationId, list.invitationIdChangeTime)
});

const isUpdatedSince = (list: ListRecord, since: number | undefined) =>
	since === undefined
		? true
		: list.createTime > since ||
		  list.titleChangeTime > since ||
		  list.invitationIdChangeTime > since;

export default (server: BaseServer, lists: Lists, memberships: Memberships): void => {
	const canAccess = async (ctx: Context, list: ListRecord): Promise<boolean> => {
		// owner can access
		if (ctx.userId === list.userId) return true;
		// members can access
		const member = await memberships.find({ listId: list.id, userId: ctx.userId });
		return !!member;
	};

	addSyncMap<List>(server, modelName, {
		access: async (ctx, id, action) => {
			if (createAction.match(action)) {
				// can't impersonate another user
				return ctx.userId === action.fields.userId;
			} else if (changeAction.match(action)) {
				const list = await lists.find({ id });
				if (!list) throw new LoguxNotFoundError();
				// can change own lists
				if (ctx.userId === list?.userId) return true;
				// member can change invitationId
				if (Object.keys(action.fields).length === 1 && action.fields.invitatationId !== undefined) {
					const member = await memberships.find({ listId: list.id, userId: ctx.userId });
					return !!member;
				}
				return false;
			} else if (deleteAction.match(action)) {
				const list = await lists.find({ id });
				if (!list) throw new LoguxNotFoundError();
				// can delete own lists
				return ctx.userId === list?.userId;
			} else {
				const list = await lists.find({ id });
				if (!list) throw new LoguxNotFoundError();
				// lists with invitation id are public
				if (!!list.invitatationId) return true;
				return canAccess(ctx, list);
			}
		},

		load: async (_, id, since) => {
			const list = await lists.find({ id });
			if (!list) throw new LoguxNotFoundError();
			return isUpdatedSince(list, since) ? toSyncMapValue(list) : false;
		},

		create: async (_ctx, id, fields, time) => {
			if (!fields.title || fields.title.length === 0) throw new Error('title must be set');
			if (!fields.userId || fields.userId.length === 0) throw new Error('userId must be set');
			if (!fields.createTime) throw new Error('createTime must be set');

			await lists.create({
				...fields,
				id,
				titleChangeTime: time,
				invitationIdChangeTime: time
			});
		},

		change: async (_, id, fields, time) => {
			const list = await lists.find({ id });
			if (!list) throw new LoguxNotFoundError();
			await lists.update(id, {
				...fields,
				titleChangeTime: fields.title ? time : undefined,
				invitationIdChangeTime: fields.invitatationId !== undefined ? time : undefined
			});
		},

		delete: async (_, id) => {
			await lists.delete(id);
		}
	});

	addSyncMapFilter<List>(server, modelName, {
		access: () => true,
		initial: async (ctx, filter, since) =>
			await lists
				.filter(filter)
				.then((lists) => lists.filter((list) => isUpdatedSince(list, since)))
				.then(async (lists) => {
					if (filter && Object.keys(filter).length === 1 && filter?.invitatationId !== undefined) {
						// if only invitation id is set, return all the matching lists, because they all are available to to join
						// TODO: should invitations be a separate entity?
						return lists;
					} else {
						const hasAccess = await Promise.all(lists.map((list) => canAccess(ctx, list)));
						return lists.filter((_, i) => hasAccess[i]);
					}
				})
				.then((lists) => lists.map(toSyncMapValue)),
		actions: (ctx) => async (_, action) =>
			await lists.find({ id: action.id }).then((list) => {
				if (!list) return false;
				return canAccess(ctx, list);
			})
	});
};
