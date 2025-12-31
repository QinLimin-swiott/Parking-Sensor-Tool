import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Bluetooth, 
  BluetoothConnected, 
  BluetoothOff, 
  Activity, 
  Settings, 
  Terminal, 
  Battery, 
  RefreshCw,
  Save,
  Car,
  Zap,
  XCircle,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Wifi,
  Smartphone
} from 'lucide-react';

// --- Types & Constants ---
const SERVICE_UUID = 0xfff0;
const NOTIFY_CHAR_UUID = 0xfff1;
const WRITE_CHAR_UUID = 0xfff2;

interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  uuid: string;
  getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  uuid: string;
  value?: DataView;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface LogEntry {
  timestamp: string;
  type: 'info' | 'error' | 'tx' | 'rx';
  message: string;
}

interface DeviceConfig {
  parkingType: 'horizontal' | 'vertical';
  targetThreshold: number;
  coverThreshold: number;
}

interface SensorData {
  occupied: boolean;
  battery: number;
  temperature: number;
  magValue: number;
  rssi: number;
  coverValue: number;
  distance: number;
  parkCount: number;
  isHighMag: boolean;
  isLowBattery: boolean;
  isWaterCover: boolean;
  isLowRssi: boolean;
}

const getTimeString = () => new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });

const strToBytes = (str: string): Uint8Array => new TextEncoder().encode(str);
const bytesToStr = (value: DataView): string => new TextDecoder('utf-8').decode(value);

const hexStringToBytes = (hexStr: string): Uint8Array | null => {
  if (hexStr.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < hexStr.length; i += 2) {
      bytes[i / 2] = parseInt(hexStr.substr(i, 2), 16);
  }
  return bytes;
};

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'status' | 'config' | 'logs'>('status');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [sensorData, setSensorData] = useState<SensorData>({
    occupied: false, battery: 0, temperature: 0, magValue: 0, rssi: 0,
    coverValue: 0, distance: 0, parkCount: 0, isHighMag: false,
    isLowBattery: false, isWaterCover: false, isLowRssi: false,
  });

  const [config, setConfig] = useState<DeviceConfig>({
    parkingType: 'horizontal',
    targetThreshold: 30,
    coverThreshold: 100,
  });

  const writeCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null);

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev.slice(-99), { timestamp: getTimeString(), type, message }]);
  };

  const vibrate = (type: 'success' | 'error' | 'light' = 'light') => {
    if ('vibrate' in navigator) {
      if (type === 'success') navigator.vibrate([10, 30, 10]);
      else if (type === 'error') navigator.vibrate([50, 50, 50]);
      else navigator.vibrate(10);
    }
  };

  const processDeviceData = (str: string) => {
    try {
      const parts = str.trim().split(':');
      if (parts.length < 2) return;
      const hexData = parts[1].replace(/\r?\n/g, "");
      const bytes = hexStringToBytes(hexData);
      if (!bytes || bytes.length < 13) return;

      const pcbTemp = bytes[0];
      const batSoc = bytes[1];
      const statusByte = bytes[2];
      const parkCnt = bytes[3];
      const magValue = bytes[5] | (bytes[6] << 8);
      const rssiValue = bytes[7] | (bytes[8] << 8);
      const coverValue = bytes[9] | (bytes[10] << 8);
      const distanceValue = bytes[11] | (bytes[12] << 8);

      const isHighMag = (statusByte & (1 << 1)) !== 0;
      const isLowBattery = (statusByte & (1 << 2)) !== 0;
      const isWaterCover = (statusByte & (1 << 3)) !== 0;
      const isOccupied = (statusByte & (1 << 4)) !== 0;
      const isLowRssi = (statusByte & (1 << 6)) !== 0;

      setSensorData({
        occupied: isOccupied, battery: batSoc, temperature: pcbTemp,
        magValue, rssi: rssiValue, coverValue, distance: distanceValue,
        parkCount: parkCnt, isHighMag, isLowBattery, isWaterCover, isLowRssi
      });
    } catch (e) {
      addLog('error', 'Parse Error');
    }
  };

  const handleATResponse = (response: string) => {
    const cleanStr = response.trim();
    if (cleanStr.startsWith('+SWQUERY:')) processDeviceData(cleanStr);
    else if (cleanStr.startsWith('+SWRDTARTH:')) {
       const val = parseInt(cleanStr.split(':')[1], 10);
       if (!isNaN(val)) setConfig(prev => ({...prev, targetThreshold: val}));
    } else if (cleanStr.startsWith('+SWRDAVGTH:')) {
       const val = parseInt(cleanStr.split(':')[1], 10);
       if (!isNaN(val)) setConfig(prev => ({...prev, coverThreshold: val}));
    } else if (cleanStr.startsWith('+SWRDPARKTYPE:')) {
       const val = cleanStr.split(':')[1].trim();
       setConfig(prev => ({...prev, parkingType: val === '0' ? 'horizontal' : 'vertical'}));
    }
  };

  const connectDevice = async () => {
    vibrate();
    setErrorMsg(null);
    try {
      if (!(navigator as any).bluetooth) throw new Error("Web Bluetooth not supported.");
      addLog('info', 'Scanning...');
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID] 
      });
      setDevice(device);
      device.addEventListener('gattserverdisconnected', onDisconnected);
      const server = await device.gatt?.connect();
      if (!server) throw new Error("GATT Error");
      serverRef.current = server;
      const service = await server.getPrimaryService(SERVICE_UUID);
      const notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID);
      const writeChar = await service.getCharacteristic(WRITE_CHAR_UUID);
      writeCharRef.current = writeChar;
      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', (event: any) => {
        const str = bytesToStr(event.target.value);
        addLog('rx', str);
        handleATResponse(str);
      });
      setIsConnected(true);
      setIsDemoMode(false);
      vibrate('success');
      await writeChar.writeValueWithoutResponse(strToBytes("SWIOTT"));
      setTimeout(() => sendATCommand("AT+SWQUERY?"), 500);
    } catch (error: any) {
      setErrorMsg(error.message);
      vibrate('error');
    }
  };

  const onDisconnected = () => {
    setIsConnected(false);
    setIsDemoMode(false);
    setDevice(null);
    writeCharRef.current = null;
    serverRef.current = null;
    vibrate('error');
  };

  const sendATCommand = async (cmd: string) => {
    if (isDemoMode) { addLog('tx', cmd); return; }
    if (!writeCharRef.current) return;
    try {
      const fullCmd = cmd.endsWith('\r\n') ? cmd : cmd + '\r\n';
      await writeCharRef.current.writeValueWithoutResponse(strToBytes(fullCmd));
      addLog('tx', fullCmd.trim());
      vibrate();
    } catch (e: any) {
      addLog('error', e.message);
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-900 safe-top safe-bottom">
        <div className="max-w-md w-full bg-slate-800 rounded-3xl shadow-2xl border border-slate-700 p-8 text-center">
          <div className="w-24 h-24 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
            <Bluetooth className="w-12 h-12 text-blue-500" />
          </div>
          <h1 className="text-3xl font-extrabold text-white mb-3">SWIOTT Tool</h1>
          <p className="text-slate-400 mb-10 text-lg">BLE Parking Sensor Configurator</p>
          
          {errorMsg && (
            <div className="mb-8 p-4 bg-red-900/40 border border-red-500/50 rounded-2xl flex items-start gap-3 text-left animate-bounce">
              <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">{errorMsg}</p>
            </div>
          )}

          <div className="space-y-4">
            <button 
              onClick={connectDevice}
              className="w-full bg-blue-600 active:scale-95 hover:bg-blue-500 text-white font-bold py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-3 text-lg shadow-lg shadow-blue-900/40"
            >
              <BluetoothConnected className="w-6 h-6" />
              Scan & Connect
            </button>
            <button 
              onClick={() => { vibrate(); setIsDemoMode(true); setIsConnected(true); }}
              className="w-full bg-slate-700 active:scale-95 text-slate-200 font-semibold py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-3 text-lg"
            >
              <Activity className="w-6 h-6" />
              Demo Interface
            </button>
          </div>
          
          <div className="mt-12 flex flex-col items-center gap-2 opacity-50">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Smartphone className="w-3 h-3" />
              <span>Android PWA Ready</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col safe-top safe-bottom">
      <header className="bg-slate-800/80 backdrop-blur-md border-b border-slate-700 px-6 py-5 sticky top-0 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-900/50">
              <Car className="text-white w-7 h-7" />
            </div>
            <div>
              <h1 className="font-bold text-white text-xl leading-tight truncate max-w-[150px]">
                {isDemoMode ? 'Demo Device' : (device?.name || 'Sensor')}
              </h1>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[10px] text-emerald-400 font-black tracking-widest uppercase">Live</span>
              </div>
            </div>
          </div>
          <button onClick={() => { vibrate('error'); serverRef.current?.disconnect(); onDisconnected(); }} className="p-3 bg-slate-700 active:bg-red-500/30 text-slate-400 rounded-2xl">
            <BluetoothOff className="w-6 h-6" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-6 space-y-6">
        <div className="grid grid-cols-3 gap-2 bg-slate-800 p-1.5 rounded-2xl shadow-inner">
          {['status', 'config', 'logs'].map((tab: any) => (
            <button
              key={tab}
              onClick={() => { vibrate(); setActiveTab(tab); }}
              className={`py-3 px-2 rounded-xl text-sm font-bold transition-all capitalize ${activeTab === tab ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 active:bg-slate-700'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'status' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-800 rounded-[2.5rem] p-8 border border-slate-700 shadow-2xl text-center relative overflow-hidden group">
              <div className={`w-40 h-40 mx-auto rounded-full flex items-center justify-center mb-6 border-[12px] transition-all duration-700 ${sensorData.occupied ? 'border-rose-500/20 bg-rose-500/5 shadow-[0_0_50px_-10px_rgba(244,63,94,0.3)]' : 'border-emerald-500/20 bg-emerald-500/5 shadow-[0_0_50px_-10px_rgba(16,185,129,0.3)]'}`}>
                {sensorData.occupied ? (
                  <XCircle className="w-20 h-20 text-rose-500 animate-in zoom-in-50" />
                ) : (
                  <CheckCircle2 className="w-20 h-20 text-emerald-500 animate-in zoom-in-50" />
                )}
              </div>
              <h2 className={`text-4xl font-black mb-2 tracking-tighter ${sensorData.occupied ? 'text-rose-500' : 'text-emerald-500'}`}>
                {sensorData.occupied ? 'OCCUPIED' : 'VACANT'}
              </h2>
              <p className="text-slate-500 font-medium">Radar Distance: <span className="text-slate-300">{sensorData.distance}m</span></p>
              
              <div className="grid grid-cols-3 gap-4 border-t border-slate-700/50 pt-8 mt-10">
                <div className="space-y-1">
                   <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Battery</div>
                   <div className="text-lg font-bold text-white flex items-center justify-center gap-1.5">
                     <Battery className={`w-5 h-5 ${sensorData.isLowBattery ? 'text-rose-500' : 'text-emerald-500'}`} />
                     {sensorData.battery}%
                   </div>
                </div>
                 <div className="border-x border-slate-700/50 space-y-1">
                   <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Temp</div>
                   <div className="text-lg font-bold text-white">{sensorData.temperature}°C</div>
                </div>
                 <div className="space-y-1">
                   <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest">RSSI</div>
                   <div className="text-lg font-bold text-white flex items-center justify-center gap-1.5">
                     <Wifi className={`w-5 h-5 ${sensorData.isLowRssi ? 'text-rose-500' : 'text-blue-500'}`} />
                     {sensorData.rssi}
                   </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className={`p-5 rounded-3xl border transition-all duration-300 ${sensorData.isHighMag ? 'bg-rose-500/10 border-rose-500/30' : 'bg-slate-800 border-slate-700'}`}>
                <Activity className={`w-6 h-6 mb-3 ${sensorData.isHighMag ? 'text-rose-400' : 'text-slate-500'}`} />
                <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Mag Value</div>
                <div className={`text-xl font-black ${sensorData.isHighMag ? 'text-rose-300' : 'text-slate-300'}`}>{sensorData.magValue}</div>
              </div>
              <div className={`p-5 rounded-3xl border transition-all duration-300 ${sensorData.isWaterCover ? 'bg-blue-500/10 border-blue-500/30' : 'bg-slate-800 border-slate-700'}`}>
                <Zap className={`w-6 h-6 mb-3 ${sensorData.isWaterCover ? 'text-blue-400' : 'text-slate-500'}`} />
                <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Water Cover</div>
                <div className={`text-xl font-black ${sensorData.isWaterCover ? 'text-blue-300' : 'text-slate-300'}`}>{sensorData.isWaterCover ? 'ACTIVE' : 'NONE'}</div>
              </div>
            </div>

            <div className="flex gap-4">
              <button onClick={() => sendATCommand("AT+SWQUERY?")} className="flex-1 bg-blue-600 active:bg-blue-700 text-white py-4 rounded-2xl font-bold transition-all shadow-lg flex items-center justify-center gap-3">
                <RefreshCw className="w-5 h-5" /> Refresh
              </button>
              <button onClick={() => sendATCommand("AT+SWRDCALI")} className="flex-1 bg-slate-800 active:bg-slate-700 text-white py-4 rounded-2xl font-bold border border-slate-700">
                Calibrate
              </button>
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-800 rounded-3xl border border-slate-700 p-8 space-y-8 shadow-xl">
              <div className="flex gap-3">
                 <button onClick={() => sendATCommand("AT+SWREBOOT")} className="flex-1 bg-slate-700 py-3 rounded-xl text-sm font-bold">Reboot</button>
                 <button onClick={() => sendATCommand("AT+SWRDENABLE=1")} className="flex-1 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 py-3 rounded-xl text-sm font-bold">Enable</button>
                 <button onClick={() => sendATCommand("AT+SWRDENABLE=0")} className="flex-1 bg-rose-600/20 text-rose-400 border border-rose-500/30 py-3 rounded-xl text-sm font-bold">Disable</button>
              </div>

              <div className="space-y-4">
                <label className="text-slate-400 text-xs font-black uppercase tracking-widest">Installation Orientation</label>
                <div className="flex bg-slate-900 p-1.5 rounded-2xl">
                  <button onClick={() => { vibrate(); setConfig({...config, parkingType: 'horizontal'}); sendATCommand("AT+SWRDPARKTYPE=0"); }} className={`flex-1 py-4 text-sm font-black rounded-xl transition-all ${config.parkingType === 'horizontal' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}>HORIZONTAL</button>
                  <button onClick={() => { vibrate(); setConfig({...config, parkingType: 'vertical'}); sendATCommand("AT+SWRDPARKTYPE=1"); }} className={`flex-1 py-4 text-sm font-black rounded-xl transition-all ${config.parkingType === 'vertical' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}>VERTICAL</button>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-slate-400 text-xs font-black uppercase tracking-widest">Target Threshold</label>
                  <div className="flex gap-3">
                     <input type="number" value={config.targetThreshold} onChange={(e) => setConfig({...config, targetThreshold: parseInt(e.target.value)})} className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-xl px-5 py-4 focus:ring-2 focus:ring-blue-500 outline-none font-bold" />
                     <button onClick={() => sendATCommand(`AT+SWRDTARTH=${config.targetThreshold}`)} className="px-8 bg-blue-600 active:bg-blue-700 text-white rounded-xl font-bold">SET</button>
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-slate-400 text-xs font-black uppercase tracking-widest">Cover Threshold</label>
                  <div className="flex gap-3">
                     <input type="number" value={config.coverThreshold} onChange={(e) => setConfig({...config, coverThreshold: parseInt(e.target.value)})} className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-xl px-5 py-4 focus:ring-2 focus:ring-blue-500 outline-none font-bold" />
                     <button onClick={() => sendATCommand(`AT+SWRDAVGTH=${config.coverThreshold}`)} className="px-8 bg-blue-600 active:bg-blue-700 text-white rounded-xl font-bold">SET</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="flex flex-col h-[60vh] animate-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-800 px-5 py-3 rounded-t-3xl border border-slate-700 flex justify-between items-center shadow-lg">
              <span className="text-[10px] font-black text-slate-500 flex items-center gap-2 uppercase tracking-widest">
                <Terminal className="w-3 h-3" /> Raw Debugger
              </span>
              <button onClick={() => { vibrate(); setLogs([]); }} className="text-[10px] font-black text-blue-400 hover:text-blue-300 uppercase">Clear</button>
            </div>
            <div className="flex-1 bg-slate-950/80 backdrop-blur-sm border-x border-b border-slate-700 rounded-b-3xl p-5 overflow-y-auto font-mono text-[10px] space-y-2">
              {logs.length === 0 && <div className="text-slate-700 text-center mt-20 italic">Listening for packets...</div>}
              {logs.map((log, i) => (
                <div key={i} className="flex gap-3 leading-relaxed">
                  <span className="text-slate-700 shrink-0 font-bold">{log.timestamp}</span>
                  <span className={`${log.type === 'tx' ? 'text-blue-400' : log.type === 'rx' ? 'text-emerald-400' : log.type === 'error' ? 'text-rose-500' : 'text-slate-500'} break-all`}>
                    {log.type === 'tx' ? '➤ ' : log.type === 'rx' ? '◀ ' : '! '}
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
            
            <div className="mt-4 flex gap-2">
               <input id="custom-cmd" type="text" placeholder="Custom AT Command..." className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" onKeyDown={(e) => { if (e.key === 'Enter') { sendATCommand(e.currentTarget.value); e.currentTarget.value = ''; } }} />
               <button onClick={() => { vibrate(); const input = document.getElementById('custom-cmd') as HTMLInputElement; if(input.value) { sendATCommand(input.value); input.value = ''; } }} className="bg-blue-600 active:bg-blue-700 text-white px-6 rounded-2xl font-black text-xs uppercase shadow-lg">SEND</button>
            </div>
          </div>
        )}
      </main>
      
      {/* 手机端底部安全边距 */}
      <div className="safe-bottom h-4"></div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);