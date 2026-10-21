/**
 * i18n strings —— merge 所有 namespace module 成单一 STRINGS dict。
 *
 * 这是 catalog 的单一权威来源 —— t / pluralize / useI18n 全部从这里读。
 * 新增 namespace 时: 1) 在 strings/ 下加一个模块, 2) 在本文件 import + merge.
 */
export type { StringEntry, Strings } from '../types';
import type { StringEntry } from '../types';

import about from './about';
import agents from './agents';
import autopilot from './autopilot';
import app from './app';
import apps from './apps';
import chat from './chat';
import collaboration from './collaboration';
import common from './common';
import composer from './composer';
import debug from './debug';
import design from './design';
import dictation from './dictation';
import files from './files';
import git from './git';
import home from './home';
import hooks from './hooks';
import kms from './kms';
import inspector from './inspector';
import media from './media';
import memory from './memory';
import mobile from './mobile';
import modal from './modal';
import models from './models';
import notifications from './notifications';
import palette from './palette';
import permissionMode from './permissionMode';
import plan from './plan';
import prompts from './prompts';
import remote from './remote';
import schedule from './schedule';
import session from './session';
import sideChannel from './sideChannel';
import settings from './settings';
import shell from './shell';
import sidebar from './sidebar';
import skills from './skills';
import slash from './slash';
import squad from './squad';
import tasks from './tasks';
import terminal from './terminal';
import threads from './threads';
import toast from './toast';
import traces from './traces';
import usage from './usage';
import workspaces from './workspaces';

export const STRINGS: Record<string, StringEntry> = {
  ...about,
  ...agents,
  ...autopilot,
  ...app,
  ...apps,
  ...chat,
  ...collaboration,
  ...common,
  ...composer,
  ...debug,
  ...design,
  ...dictation,
  ...files,
  ...git,
  ...home,
  ...hooks,
  ...kms,
  ...inspector,
  ...media,
  ...memory,
  ...mobile,
  ...modal,
  ...models,
  ...notifications,
  ...palette,
  ...permissionMode,
  ...plan,
  ...prompts,
  ...remote,
  ...schedule,
  ...session,
  ...sideChannel,
  ...settings,
  ...shell,
  ...sidebar,
  ...skills,
  ...slash,
  ...squad,
  ...tasks,
  ...terminal,
  ...threads,
  ...toast,
  ...traces,
  ...usage,
  ...workspaces,
};

export type LocaleKey = keyof typeof STRINGS;

/** 列出所有已注册的 keys —— 供 i18n.test 校验 catalog parity. */
export const ALL_KEYS: readonly LocaleKey[] = Object.keys(STRINGS) as LocaleKey[];
