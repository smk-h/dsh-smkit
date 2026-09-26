/**
 * Simplified Chinese dictionary for the `notify` locale namespace.
 *
 * The notify tab's own copy: what a notification is, the two toggles and
 * their trade-offs, the test fire's promise, and the one environmental caveat
 * (Windows-only, Focus Assist) a user blaming the plugin needs to read first.
 * The tab label lives in the merged section's dictionary — the strip names
 * its pages, not the pages themselves.
 */

import type { LocaleDict } from '../../../platform/types'

export const NOTIFY_LOCALE_ZH: LocaleDict = {
  intro:
    'dsh 的任务完成、出错，或需要你确认工具调用、回答问题时，会从 dsh 所在的机器弹出 Windows 系统通知并播放提示音。页面正在前台聚焦时不打扰；浏览器没开、页面已关闭时照常提醒——通知由 dsh 进程直接发出，不经过网页。',
  enabledTitle: '系统通知',
  enabledHelp: '关闭后不再弹任何通知，也不播放提示音。',
  soundTitle: '提示音',
  soundHelp: '弹通知时附带一声提示音，音色与 ZCode 相同；关闭则静音弹出。',
  durationTitle: '常驻时长',
  durationHelp: '通知在屏幕右下角停留多久，之后进通知中心；「常驻」会一直显示，直到手动关闭。',
  durationShort: '标准（约 5 秒）',
  durationLong: '加长（约 25 秒）',
  durationReminder: '常驻，直到手动关闭',
  webNotifTitle: '浏览器通知',
  webNotifHelp: 'dsh 跑在远程主机上时由浏览器代发通知：保持本页开启并授权后生效，页面关闭后收不到。',
  webNotifEnable: '授权通知',
  webNotifGranted: '已授权',
  webNotifDenied: '已被拒绝，请在浏览器的站点设置中重新允许',
  webNotifUnsupported: '当前环境不支持，需通过 localhost 或 https 访问',
  webNotifFailed: '授权请求失败。',
  on: '已开启',
  off: '已关闭',
  testButton: '发送测试通知',
  testDone: '已发送，请留意屏幕右下角。',
  testFailed: '测试通知发送失败（{status}）。',
  saveFailed: '保存失败（{status}）。',
  note:
    '仅 Windows 生效；点击通知会打开 dsh 页面。若系统开启了专注助手/勿扰模式，通知可能被系统拦截。',
}
