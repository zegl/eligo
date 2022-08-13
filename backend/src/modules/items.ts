import {
	addSyncMap,
	addSyncMapFilter,
	BaseServer,
	ChangedAt,
	NoConflictResolution,
	SyncMapData
} from '@logux/server';
import { defineSyncMapActions, LoguxNotFoundError } from '@logux/actions';
import type { Item } from '@picker/protocol';

import { items, lists } from '../db/index.js';

const modelName = 'items';

const [createAction, changeAction, deleteAction, _createdAction, _changedAction, _deletedAction] =
	defineSyncMapActions<Item>(modelName);

export default (server: BaseServer): void => {
	addSyncMap<Item>(server, modelName, {
		access: async (ctx, id, action) => {
			if (createAction.match(action)) {
                // can't impersonate another user
				return ctx.userId === action.fields.userId;
			} else if (changeAction.match(action)) {
				const item = await items.find({ id });
				if (!item) throw new LoguxNotFoundError();
                // can change own items
				if (ctx.userId === item?.userId) return true;
				const list = await lists.find({ id: item.listId });
                // can change items in own lists
				return ctx.userId === list?.userId;
			} else if (deleteAction.match(action)) {
				const item = await items.find({ id });
				if (!item) throw new LoguxNotFoundError();
                // can delete own items
				if (ctx.userId === item?.userId) return true;
				const list = await lists.find({ id: item.listId });
                // can delete items in own lists
				return ctx.userId === list?.userId;
			} else {
				return false;
			}
		},

		load: async (_, id) => {
			const item = await items.find({ id });
			if (!item) throw new LoguxNotFoundError();
			return {
				id,
				listId: NoConflictResolution(item.listId),
				text: ChangedAt(item.text, item.textChangeTime)
			} as SyncMapData<Item>;
		},

		create: (_ctx, id, fields, time) => {
			items.create({
				...fields,
				id,
				textChangeTime: time
			});
		},

		change: async (_, id, fields) => {
			const item = await items.find({ id });
			if (!item) throw new LoguxNotFoundError();
			await items.change(id, fields);
		},

		delete: (_, id) => items.delete(id)
	});

	addSyncMapFilter<Item>(server, modelName, {
		access: () => true,
		initial: () =>
			items.list().then((lists) =>
				lists.map(
					({ id, text, listId, textChangeTime }) =>
						({
							id,
							listId: NoConflictResolution(listId),
							text: ChangedAt(text, textChangeTime)
						} as SyncMapData<Item>)
				)
			)
	});
};
