import { NativeModules, Platform } from 'react-native';

type DiscoverNativeResponse = {
  urls?: string[];
  count?: number;
};

type CheckEndpointResponse = {
  ok: boolean;
  status: number;
};

type PrintResponse = {
  ok: boolean;
  target: string;
  status: number;
};

type AppInfoResponse = {
  versionName?: string;
  versionCode?: string;
  packageName?: string;
};

type MobilePrintAgentNative = {
  discoverPrinters: (prefixes: string[], port: number, timeoutMs: number) => Promise<DiscoverNativeResponse>;
  checkEndpoint: (url: string, timeoutMs: number) => Promise<CheckEndpointResponse>;
  print: (url: string, payloadJson: string, timeoutMs: number) => Promise<PrintResponse>;
  printHtml: (title: string, html: string) => Promise<boolean>;
  getAppInfo: () => Promise<AppInfoResponse>;
};

const native = NativeModules.MobilePrintAgent as MobilePrintAgentNative | undefined;

export function hasNativePrintAgent(): boolean {
  return Platform.OS === 'android' && !!native;
}

export async function discoverPrintersNative(prefixes: string[], port = 8081, timeoutMs = 260): Promise<string[]> {
  if (!hasNativePrintAgent() || !native) return [];
  const response = await native.discoverPrinters(prefixes, port, timeoutMs);
  return (response?.urls ?? []).filter(Boolean);
}

export async function checkEndpointNative(url: string, timeoutMs = 2000): Promise<CheckEndpointResponse> {
  if (!hasNativePrintAgent() || !native) {
    return { ok: false, status: 0 };
  }
  return native.checkEndpoint(url, timeoutMs);
}

export async function printNative(url: string, payload: unknown, timeoutMs = 4000): Promise<PrintResponse> {
  if (!hasNativePrintAgent() || !native) {
    throw new Error('Native print agent no disponible en este dispositivo.');
  }
  return native.print(url, JSON.stringify(payload), timeoutMs);
}

export async function printHtmlNative(title: string, html: string): Promise<boolean> {
  if (!hasNativePrintAgent() || !native?.printHtml) {
    throw new Error('Función de impresión PDF no disponible en este dispositivo.');
  }
  return native.printHtml(title, html);
}

export async function getAppInfoNative(): Promise<AppInfoResponse> {
  if (!hasNativePrintAgent() || !native?.getAppInfo) {
    return {};
  }
  return native.getAppInfo();
}
