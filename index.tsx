import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Bluetooth, 
  BluetoothConnected, 
  BluetoothOff, 
  Activity, 
  Terminal, 
  Battery, 
  RefreshCw,
  Car,
  Zap,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  Smartphone,
  Thermometer,
  Layers,
  BarChart3,
  Gauge,
  RotateCcw,
  Compass,
  Loader2,
  MoreVertical,
  ChevronLeft,
  Settings,
  LayoutDashboard,
  Clock,
  Radio,
  Globe,
  Save,
  Search,
  Hash,
  Rss,
  Lock,
  Unlock
} from 'lucide-react';

// --- Types & Constants ---
const SERVICE_UUID = 0xfff0;
const NOTIFY_CHAR_UUID = 0xfff1;
const WRITE_CHAR_UUID = 0xfff2;

const isValidDeviceName = (name?: string) => {
  if (!name) return false;
  const hexRegex = /^[0-9a-fA-F]{16}$/;
  return hexRegex.test(name);
};

interface LogEntry {
  timestamp: string;
  type: 'info' | 'error' | 'tx' | 'rx';
  message: string;
}

interface DeviceConfig {
  parkingType: 'horizontal' | 'vertical';
  targetThreshold: number;
  coverThreshold: number;
  radarEnabled: boolean;
}

interface LoraConfig {
  devEui: string;
  appEui: string;
  devAddr: string;
  appSKey: string;
  nwkSKey: string;
  region: string;
}

interface NbiotConfig {
  apn: string;
  mqttHost: string;
  mqttPort: string;
  mqttUser: string;
  mqttPass: string;
  mqttClean: string;
  mqttKeepalive: string;
  mqttSsl: string;
  status: string;
  imei: string;
  imsi: string;
  ccid: string;
  band: string;
  operator: string;
  rssi: string;
  snr: string;
}

interface SensorData {
  occupied: boolean;
  battery: number;
  temperature: number;
  rssi: number;
  coverValue: number;
  distance: number;
  magValue: number;
  eventType: number;
  magX: number;
  magY: number;
  magZ: number;
  isValid: boolean;
  errCode: number;
  parkCount24h: number;
  parkCountCurrentHour: number;
  statusByte: number;
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

// 解析事件类型文字 (0-No event, 1-Entry, 2-Exit, 3-Movement)
const getEventTypeText = (type: number) => {
  switch(type) {
    case 1: return 'Entry';
    case 2: return 'Exit';
    case 3: return 'Move';
    default: return 'None';
  }
};

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [device, setDevice] = useState<any | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'status' | 'config' | 'logs'>('status');
  const [configSubTab, setConfigSubTab] = useState<'lora' | 'nbiot'>('lora');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [operationStatus, setOperationStatus] = useState<string | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  
  const [sensorData, setSensorData] = useState<SensorData>({
    occupied: false, battery: 0, temperature: 0, rssi: 0, coverValue: 0, distance: 0, magValue: 0,
    eventType: 0, magX: 0, magY: 0, magZ: 0, isValid: false, errCode: 0,
    parkCount24h: 0, parkCountCurrentHour: 0, statusByte: 0,
    isHighMag: false, isLowBattery: false, isWaterCover: false, isLowRssi: false
  });

  const [config, setConfig] = useState<DeviceConfig>({
    parkingType: 'horizontal',
    targetThreshold: 30,
    coverThreshold: 100,
    radarEnabled: false
  });

  const [lora, setLora] = useState<LoraConfig>({
    devEui: '', appEui: '', devAddr: '', appSKey: '', nwkSKey: '', region: ''
  });

  const [nbiot, setNbiot] = useState<NbiotConfig>({
    apn: '', mqttHost: '', mqttPort: '', mqttUser: '', mqttPass: '', mqttClean: '', mqttKeepalive: '', mqttSsl: '0',
    status: 'Unknown', imei: '', imsi: '', ccid: '', band: '', operator: '', rssi: '', snr: ''
  });

  const writeCharRef = useRef<any>(null);
  const serverRef = useRef<any>(null);
  const pollingIntervalRef = useRef<any>(null);
  const operationTimeoutRef = useRef<any>(null);

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

  // 状态页面轮询
  useEffect(() => {
    if (isConnected && !isDemoMode && !isOperating) {
      pollingIntervalRef.current = setInterval(() => {
        sendATCommand("AT+SWQUERY?");
      }, 10000);
    } else {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, [isConnected, isDemoMode, isOperating]);

  // 当切换到 CONFIG 页面时，主动拉取核心参数 (SWRDTARTH, SWRDPARKTYPE, SWRDENABLE)
  useEffect(() => {
    if (activeTab === 'config' && isConnected) {
      queryMainConfig();
    }
  }, [activeTab, isConnected]);

  const queryMainConfig = () => {
    const cmds = ["AT+SWRDTARTH?", "AT+SWRDPARKTYPE?", "AT+SWRDENABLE?"];
    cmds.forEach((cmd, i) => {
      // 严格遵守 300ms 时间间隔要求
      setTimeout(() => sendATCommand(cmd), i * 350);
    });
  };

  const handleATResponse = (line: string) => {
    const cleanStr = line.trim();
    
    // 校准过程解析
    if (cleanStr.startsWith('+SWRDCALI:')) {
      const splitPos = cleanStr.indexOf(':');
      const parts = cleanStr.substring(splitPos + 1).split(',');
      const countdown = parts[1] || '...';
      setOperationStatus(`Calibrating: ${countdown}s left...`);
      setIsOperating(true);
    } 
    else if (cleanStr === 'OK') {
      const currentOp = operationStatus;
      if (currentOp?.includes('Calibrating')) {
        setOperationStatus('Calibration Successful!');
        clearOperationState(null, 2000);
      } else if (currentOp?.includes('Rebooting')) {
        setOperationStatus('Rebooting... Disconnecting');
        setTimeout(() => {
          serverRef.current?.disconnect();
          onDisconnected();
        }, 500);
      } else {
        clearOperationState(null, 1000);
      }
    } 
    else if (cleanStr === 'ERROR') {
      vibrate('error');
      clearOperationState('Operation Failed', 3000);
    }
    else if (cleanStr.startsWith('+SWQUERY:')) {
      parseSWQUERY(cleanStr);
    } 
    // 解析雷达状态详细数据 (SWRDSTATUS)
    else if (cleanStr.startsWith('+SWRDSTATUS:') || cleanStr.startsWith('+MRSTATUS:')) {
      parseSWRDSTATUS(cleanStr);
    } 
    // 解析雷达核心配置项
    else if (cleanStr.startsWith('+SWRDTARTH:')) {
       const val = parseInt(cleanStr.split(':')[1], 10);
       if (!isNaN(val)) setConfig(prev => ({...prev, targetThreshold: val}));
    } else if (cleanStr.startsWith('+SWRDPARKTYPE:')) {
       const val = cleanStr.split(':')[1].trim();
       setConfig(prev => ({...prev, parkingType: val === '0' ? 'horizontal' : 'vertical'}));
    } else if (cleanStr.startsWith('+SWRDENABLE:')) {
       const val = cleanStr.split(':')[1].trim();
       setConfig(prev => ({...prev, radarEnabled: val === '1'}));
    }
    // Lora Parsing
    else if (cleanStr.startsWith('+CDEVEUI:')) setLora(prev => ({...prev, devEui: cleanStr.split(':')[1]}));
    else if (cleanStr.startsWith('+CAPPEUI:')) setLora(prev => ({...prev, appEui: cleanStr.split(':')[1]}));
    else if (cleanStr.startsWith('+CDEVADDR:')) setLora(prev => ({...prev, devAddr: cleanStr.split(':')[1]}));
    else if (cleanStr.startsWith('+CAPPSKEY:')) setLora(prev => ({...prev, appSKey: cleanStr.split(':')[1]}));
    else if (cleanStr.startsWith('+CNWKSKEY:')) setLora(prev => ({...prev, nwkSKey: cleanStr.split(':')[1]}));
    else if (cleanStr.startsWith('+CREGION:')) setLora(prev => ({...prev, region: cleanStr.split(':')[1]}));
    // NBIOT Parsing
    else if (cleanStr.startsWith('+NBAPN:')) setNbiot(prev => ({...prev, apn: cleanStr.split(':')[1]}));
    else if (cleanStr.startsWith('+NBMQTT:')) {
      const parts = cleanStr.split(':')[1].split(',');
      if (parts.length >= 6) {
        setNbiot(prev => ({
          ...prev, 
          mqttHost: parts[0], 
          mqttPort: parts[1], 
          mqttUser: parts[2],
          mqttPass: parts[3], 
          mqttClean: parts[4], 
          mqttKeepalive: parts[5],
          mqttSsl: parts[6] || '0'
        }));
      }
    }
    else if (cleanStr.startsWith('+NBCONNECT:')) {
      const parts = cleanStr.split(':')[1].split(',');
      const statusMap = ["Not registered", "Registered (No MQTT)", "Connected"];
      setNbiot(prev => ({
        ...prev, 
        status: statusMap[parseInt(parts[0])] || "Error",
        imei: parts[1] || '',
        imsi: parts[2] || '',
        ccid: parts[3] || '',
        band: parts[4] || '',
        operator: parts[5] || '',
        rssi: parts[6] || '',
        snr: parts[7] || ''
      }));
    }
  };

  const parseSWRDSTATUS = (str: string) => {
    try {
      const splitPos = str.indexOf(':');
      if (splitPos === -1) return;
      const parts = str.substring(splitPos + 1).split(',');
      if (parts.length < 11) return;
      setSensorData(prev => ({
        ...prev,
        eventType: parseInt(parts[0]),
        occupied: parseInt(parts[1]) === 1,
        magX: parseInt(parts[2]),
        magY: parseInt(parts[3]),
        magZ: parseInt(parts[4]),
        magValue: parseInt(parts[5]),
        rssi: parseInt(parts[6]),
        coverValue: parseInt(parts[7]),
        distance: parseInt(parts[8]),
        isValid: parseInt(parts[9]) === 1,
        errCode: parseInt(parts[10])
      }));
    } catch (e) {
      addLog('error', 'SWRDSTATUS Parse Error');
    }
  };

  const parseSWQUERY = (str: string) => {
    try {
      const splitPos = str.indexOf(':');
      if (splitPos === -1) return;
      const hexData = str.substring(splitPos + 1).trim();
      const bytes = hexStringToBytes(hexData);
      if (!bytes || bytes.length < 13) return;
      const status = bytes[2];
      setSensorData(prev => ({
        ...prev,
        temperature: bytes[0],
        battery: bytes[1],
        statusByte: status,
        parkCount24h: bytes[3],
        parkCountCurrentHour: bytes[4],
        magValue: bytes[5] | (bytes[6] << 8),
        rssi: bytes[7] | (bytes[8] << 8),
        coverValue: bytes[9] | (bytes[10] << 8),
        distance: bytes[11] | (bytes[12] << 8),
        isHighMag: (status & (1 << 1)) !== 0,
        isLowBattery: (status & (1 << 2)) !== 0,
        isWaterCover: (status & (1 << 3)) !== 0,
        isLowRssi: (status & (1 << 6)) !== 0
      }));
    } catch (e) {
      addLog('error', 'SWQUERY Parse Error');
    }
  };

  const clearOperationState = (message: string | null = null, delay: number = 2000) => {
    if (message) setOperationStatus(message);
    if (operationTimeoutRef.current) clearTimeout(operationTimeoutRef.current);
    setTimeout(() => {
      setOperationStatus(null);
      setIsOperating(false);
    }, delay);
  };

  const connectDevice = async () => {
    vibrate();
    setErrorMsg(null);
    setIsConnecting(false);
    try {
      if (!(navigator as any).bluetooth) throw new Error("Bluetooth not supported.");
      addLog('info', 'Scanning for sensors...');
      const hexChars = '0123456789abcdefABCDEF'.split('');
      const scanFilters = hexChars.map(char => ({
        services: [SERVICE_UUID],
        namePrefix: char
      }));
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: scanFilters,
        optionalServices: [SERVICE_UUID] 
      });
      if (!isValidDeviceName(device.name)) {
        throw new Error(`Invalid device ID: "${device.name}"`);
      }
      
      // 用户选择了设备，开始连接过程
      setIsConnecting(true);
      setDevice(device);
      device.addEventListener('gattserverdisconnected', onDisconnected);
      addLog('info', `Connecting...`);
      
      const server = await device.gatt?.connect();
      serverRef.current = server;
      const service = await server.getPrimaryService(SERVICE_UUID);
      const notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID);
      const writeChar = await service.getCharacteristic(WRITE_CHAR_UUID);
      writeCharRef.current = writeChar;
      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', (event: any) => {
        const fullRawStr = bytesToStr(event.target.value);
        const lines = fullRawStr.split(/\r\n|\r|\n/).filter(l => l.trim().length > 0);
        lines.forEach(line => {
          addLog('rx', line.trim());
          handleATResponse(line);
        });
      });
      
      setIsConnected(true);
      setIsConnecting(false);
      setIsDemoMode(false);
      vibrate('success');
      await writeChar.writeValueWithoutResponse(strToBytes("SWIOTT"));
      
      // 首次连接成功后获取核心状态和配置
      setTimeout(() => {
        sendATCommand("AT+SWQUERY?");
        queryMainConfig();
      }, 500);
      
      setTimeout(() => {
        queryLoraConfig();
        queryNbiotConfig();
      }, 2000);
    } catch (error: any) {
      setErrorMsg(error.message || "Connection failed");
      setIsConnecting(false);
      vibrate('error');
    }
  };

  const queryLoraConfig = () => {
    ["AT+CDEVEUI?", "AT+CAPPEUI?", "AT+CDEVADDR?", "AT+CAPPSKEY?", "AT+CNWKSKEY?", "AT+CREGION?"].forEach((cmd, i) => {
      setTimeout(() => sendATCommand(cmd), i * 350);
    });
  };

  const queryNbiotConfig = () => {
    ["AT+NBAPN?", "AT+NBMQTT?", "AT+NBCONNECT?"].forEach((cmd, i) => {
      setTimeout(() => sendATCommand(cmd), i * 350);
    });
  };

  const onDisconnected = () => {
    setIsConnected(false);
    setIsConnecting(false);
    setIsDemoMode(false);
    setDevice(null);
    writeCharRef.current = null;
    serverRef.current = null;
    setIsOperating(false);
    setOperationStatus(null);
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    if (operationTimeoutRef.current) clearTimeout(operationTimeoutRef.current);
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

  const handleCalibrate = () => {
    setOperationStatus('Initializing Calibration...');
    setIsOperating(true);
    sendATCommand("AT+SWRDCALI");
    if (operationTimeoutRef.current) clearTimeout(operationTimeoutRef.current);
    operationTimeoutRef.current = setTimeout(() => {
      if (isOperating) {
        addLog('error', 'Calibration timed out');
        clearOperationState('Calibration Timed Out', 3000);
      }
    }, 30000);
  };

  const handleReboot = () => {
    setOperationStatus('Rebooting...');
    setIsOperating(true);
    sendATCommand("AT+SWREBOOT");
    if (operationTimeoutRef.current) clearTimeout(operationTimeoutRef.current);
    operationTimeoutRef.current = setTimeout(() => {
      if (isOperating) {
        clearOperationState('Rebooting Command Sent', 3000);
      }
    }, 15000);
  };

  const renderLoraTab = () => (
    <div className="space-y-3 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 gap-3">
        {[
          { label: 'DevEUI (16 hex)', key: 'devEui', cmd: 'AT+CDEVEUI=' },
          { label: 'AppEUI (16 hex)', key: 'appEui', cmd: 'AT+CAPPEUI=' },
          { label: 'DevAddr (8 hex)', key: 'devAddr', cmd: 'AT+CDEVADDR=' },
          { label: 'AppSKey (32 hex)', key: 'appSKey', cmd: 'AT+CAPPSKEY=' },
          { label: 'NwkSKey (32 hex)', key: 'nwkSKey', cmd: 'AT+CNWKSKEY=' },
        ].map((item) => (
          <div key={item.key} className="space-y-1">
            <label className="text-[9px] font-black text-slate-500 uppercase">{item.label}</label>
            <div className="flex gap-1.5">
              <input 
                type="text" 
                value={(lora as any)[item.key]} 
                onChange={(e) => setLora({...lora, [item.key]: e.target.value})}
                className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-md px-3 py-2 text-[10px] font-mono focus:ring-1 focus:ring-blue-500 outline-none" 
              />
              <button 
                onClick={() => sendATCommand(`${item.cmd}${(lora as any)[item.key]}`)} 
                className="bg-blue-600 active:bg-blue-700 text-white p-2 rounded-md"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        <div className="space-y-1">
          <label className="text-[9px] font-black text-slate-500 uppercase">Region</label>
          <div className="flex gap-1.5">
            <select 
              value={lora.region} 
              onChange={(e) => {
                const val = e.target.value;
                setLora({...lora, region: val});
                sendATCommand(`AT+CREGION=${val}`);
              }}
              className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-md px-3 py-2 text-[10px] font-mono focus:ring-1 focus:ring-blue-500 outline-none appearance-none"
            >
              {["AS923", "AU915", "CN470", "CN779", "EU433", "EU868", "KR920", "IN865", "US915", "RU864"].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button onClick={queryLoraConfig} className="bg-slate-700 text-white p-2 rounded-md">
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderNbiotTab = () => (
    <div className="space-y-3 animate-in fade-in duration-300">
      <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 space-y-3 mb-3 shadow-inner">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Status</span>
            <span className={`text-[10px] font-bold truncate ${nbiot.status.includes('Connected') ? 'text-emerald-400' : 'text-orange-400'}`}>{nbiot.status}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Operator</span>
            <span className="text-[10px] font-mono text-white truncate">{nbiot.operator || '---'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">IMEI</span>
            <span className="text-[10px] font-mono text-white truncate">{nbiot.imei || '---'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">IMSI</span>
            <span className="text-[10px] font-mono text-white truncate">{nbiot.imsi || '---'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">CCID</span>
            <span className="text-[10px] font-mono text-white truncate">{nbiot.ccid || '---'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Band</span>
            <span className="text-[10px] font-mono text-white truncate">{nbiot.band || '---'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Signal</span>
            <span className="text-[10px] font-mono text-white">{nbiot.rssi} dBm</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">SNR</span>
            <span className="text-[10px] font-mono text-white">{nbiot.snr} dB</span>
          </div>
        </div>

        <div className="mt-1 pt-3 border-t border-slate-700/50 space-y-1">
          <label className="text-[9px] font-black text-slate-500 uppercase">APN</label>
          <div className="flex gap-1.5">
            <input 
              type="text" 
              value={nbiot.apn} 
              onChange={(e) => setNbiot({...nbiot, apn: e.target.value})}
              className="flex-1 bg-slate-900/80 border border-slate-700 text-white rounded-md px-3 py-2 text-[10px] font-mono outline-none focus:ring-1 focus:ring-blue-500" 
              placeholder="e.g. ctnb"
            />
            <button 
              onClick={() => sendATCommand(`AT+NBAPN=${nbiot.apn}`)} 
              className="bg-blue-600 active:bg-blue-700 text-white p-2 rounded-md shadow transition-transform active:scale-95"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="pt-1 flex gap-1.5">
          <button onClick={() => sendATCommand("AT+NBCONNECT=1")} className="flex-1 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 py-2 rounded-md text-[9px] font-bold uppercase">Connect</button>
          <button onClick={() => sendATCommand("AT+NBCONNECT=0")} className="flex-1 bg-rose-600/20 text-rose-400 border border-rose-500/30 py-2 rounded-md text-[9px] font-bold uppercase">Disconnect</button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="p-3 bg-slate-900/30 rounded-lg border border-slate-700/30 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[9px] font-black text-slate-500 uppercase tracking-wide">MQTT Broker</label>
            <div className="flex items-center gap-2">
              <span className={`text-[8px] font-bold uppercase ${nbiot.mqttSsl === '1' ? 'text-blue-400' : 'text-slate-500'}`}>SSL</span>
              {nbiot.mqttSsl === '1' ? <Lock className="w-2.5 h-2.5 text-blue-400" /> : <Unlock className="w-2.5 h-2.5 text-slate-500" />}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <input placeholder="Host" value={nbiot.mqttHost} onChange={e => setNbiot({...nbiot, mqttHost: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-md px-2.5 py-1.5 text-[10px]" />
            </div>
            <input placeholder="Port" value={nbiot.mqttPort} onChange={e => setNbiot({...nbiot, mqttPort: e.target.value})} className="bg-slate-900 border border-slate-700 text-white rounded-md px-2.5 py-1.5 text-[10px]" />
            <input placeholder="Keepalive" value={nbiot.mqttKeepalive} onChange={e => setNbiot({...nbiot, mqttKeepalive: e.target.value})} className="bg-slate-900 border border-slate-700 text-white rounded-md px-2.5 py-1.5 text-[10px]" />
            <input placeholder="User" value={nbiot.mqttUser} onChange={e => setNbiot({...nbiot, mqttUser: e.target.value})} className="bg-slate-900 border border-slate-700 text-white rounded-md px-2.5 py-1.5 text-[10px]" />
            <input placeholder="Pass" type="password" value={nbiot.mqttPass} onChange={e => setNbiot({...nbiot, mqttPass: e.target.value})} className="bg-slate-900 border border-slate-700 text-white rounded-md px-2.5 py-1.5 text-[10px]" />
            
            <div className="col-span-2 space-y-1">
              <label className="text-[8px] font-black text-slate-500 uppercase">SSL Connection</label>
              <div className="flex bg-slate-900 p-0.5 rounded-md border border-slate-700">
                <button 
                  onClick={() => setNbiot({...nbiot, mqttSsl: '0'})}
                  className={`flex-1 py-1 text-[8px] font-bold rounded transition-all ${nbiot.mqttSsl === '0' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}
                >
                  DISABLED
                </button>
                <button 
                  onClick={() => setNbiot({...nbiot, mqttSsl: '1'})}
                  className={`flex-1 py-1 text-[8px] font-bold rounded transition-all ${nbiot.mqttSsl === '1' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
                >
                  ENABLED
                </button>
              </div>
            </div>
          </div>
          
          <button 
            onClick={() => sendATCommand(`AT+NBMQTT=${nbiot.mqttHost},${nbiot.mqttPort},${nbiot.mqttUser},${nbiot.mqttPass},${nbiot.mqttClean || '0'},${nbiot.mqttKeepalive || '120'},${nbiot.mqttSsl || '0'}`)} 
            className="w-full bg-blue-600 text-white py-2 rounded-md font-bold text-[10px] uppercase transition-all active:scale-[0.98] shadow-lg border border-blue-400/20"
          >
            Update MQTT
          </button>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-[#111827] flex flex-col safe-top safe-bottom">
        <header className="px-6 py-4 flex items-center justify-between border-b border-slate-800/50">
          <div className="flex items-center gap-4">
            <ChevronLeft className="w-6 h-6 text-white opacity-40" />
            <RefreshCw className="w-5 h-5 text-white opacity-40" />
          </div>
          <span className="text-white font-medium text-sm">SWIOTT Sensor Tool</span>
          <MoreVertical className="w-6 h-6 text-white opacity-40" />
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-8 pb-10">
          <div className="relative mb-10">
            <div className="w-32 h-32 rounded-lg bg-blue-600/10 flex items-center justify-center border border-blue-500/10">
               <div className="w-20 h-20 rounded-md bg-blue-500/20 flex items-center justify-center">
                 <Bluetooth className={`w-10 h-10 ${isConnecting ? 'text-blue-400 animate-pulse' : 'text-blue-500'}`} />
               </div>
            </div>
          </div>

          <div className="text-center space-y-3 mb-12">
            <h1 className="text-white text-2xl font-bold tracking-tight">SWIOTT Tool</h1>
            <p className="text-slate-400 text-xs max-w-[200px] mx-auto">
              Bluetooth Parking Sensor Configurator
            </p>
          </div>

          {errorMsg && (
            <div className="mb-6 w-full max-w-sm p-3 bg-red-900/20 border border-red-500/20 rounded-md flex items-start gap-2 text-left">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-red-200">{errorMsg}</p>
            </div>
          )}

          {/* 连接中提示 */}
          {isConnecting && (
            <div className="mb-4 flex items-center gap-2 text-blue-400 animate-in fade-in slide-in-from-bottom-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm font-bold tracking-wide uppercase">Connecting...</span>
            </div>
          )}

          <button 
            onClick={connectDevice} 
            disabled={isConnecting}
            className={`w-full max-w-xs bg-blue-600 active:scale-[0.98] text-white font-bold py-3.5 px-6 rounded-md transition-all flex items-center justify-center gap-2 text-base shadow-lg ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <BluetoothConnected className="w-5 h-5" /> 
            Connect Device
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col safe-top safe-bottom relative">
      <header className="bg-slate-800/80 backdrop-blur-md border-b border-slate-700 px-4 py-3 sticky top-0 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className={`w-9 h-9 rounded-md flex items-center justify-center shadow transition-colors shrink-0 ${sensorData.occupied ? 'bg-rose-600' : 'bg-emerald-600'}`}>
              <Car className="text-white w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-white text-sm leading-none truncate">{device?.name || 'Sensor'}</h1>
              <div className="flex items-center gap-1 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sensorData.isValid ? 'bg-emerald-500' : 'bg-slate-500'} animate-pulse`}></span>
                <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Radar: {sensorData.isValid ? 'Valid' : 'Invalid'}</span>
              </div>
            </div>
          </div>
          <button onClick={() => { vibrate('error'); serverRef.current?.disconnect(); onDisconnected(); }} className="p-2 bg-slate-700 active:bg-rose-500/20 text-slate-400 rounded-md ml-2">
            <BluetoothOff className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 space-y-4 pb-20">
        {activeTab === 'status' && (
          <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
            <div className="bg-slate-800 rounded-lg p-5 border border-slate-700 shadow-xl text-center relative overflow-hidden">
              <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-4 border-8 transition-all duration-700 ${sensorData.occupied ? 'border-rose-500/20 bg-rose-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
                {sensorData.occupied ? <XCircle className="w-10 h-10 text-rose-500" /> : <CheckCircle2 className="w-10 h-10 text-emerald-500" />}
              </div>
              <h2 className={`text-2xl font-black mb-1 tracking-tight ${sensorData.occupied ? 'text-rose-500' : 'text-emerald-500'}`}>
                {sensorData.occupied ? 'OCCUPIED' : 'VACANT'}
              </h2>
              
              <div className="grid grid-cols-3 gap-1 border-t border-slate-700/50 pt-4 mt-6">
                <div className="space-y-0.5">
                   <div className="text-[8px] font-black text-slate-500 uppercase">Battery</div>
                   <div className={`text-sm font-bold flex items-center justify-center gap-1 ${sensorData.isLowBattery ? 'text-rose-500' : 'text-emerald-500'}`}>
                     <Battery className="w-3.5 h-3.5" />{sensorData.battery}%
                   </div>
                </div>
                 <div className="border-x border-slate-700/50 space-y-0.5">
                   <div className="text-[8px] font-black text-slate-500 uppercase">Temp</div>
                   <div className="text-sm font-bold text-white flex items-center justify-center gap-1">
                     <Thermometer className="w-3.5 h-3.5 text-orange-500" />{sensorData.temperature}°C
                   </div>
                </div>
                 <div className="space-y-0.5">
                   <div className="text-[8px] font-black text-slate-500 uppercase">24h Parks</div>
                   <div className="text-sm font-bold text-blue-400">{sensorData.parkCount24h}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1 border-t border-slate-700/50 pt-4 mt-4">
                <div className="space-y-0.5">
                   <div className="text-[8px] font-black text-slate-500 uppercase">Event</div>
                   <div className="text-sm font-bold text-slate-200 flex items-center justify-center gap-1">
                     <Activity className="w-3.5 h-3.5 text-blue-400" />{getEventTypeText(sensorData.eventType)}
                   </div>
                </div>
                 <div className="border-x border-slate-700/50 space-y-0.5">
                   <div className="text-[8px] font-black text-slate-500 uppercase">Distance</div>
                   <div className="text-sm font-bold text-white flex items-center justify-center gap-1">
                     <Gauge className="w-3.5 h-3.5 text-emerald-400" />{sensorData.distance}cm
                   </div>
                </div>
                 <div className="space-y-0.5">
                   <div className="text-[8px] font-black text-slate-500 uppercase">RSSI</div>
                   <div className="text-sm font-bold text-slate-200 flex items-center justify-center gap-1">
                     <Wifi className="w-3.5 h-3.5 text-purple-400" />{sensorData.rssi}
                   </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 shadow-md">
              <h3 className="text-slate-400 text-[8px] font-black uppercase tracking-widest mb-4 flex items-center gap-1.5">
                <Layers className="w-2.5 h-2.5" /> Sensor Telemetry
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {[['mag_x', sensorData.magX], ['mag_y', sensorData.magY], ['mag_z', sensorData.magZ]].map(([axis, val]) => (
                  <div key={axis} className="bg-slate-900/50 rounded-md p-2 border border-slate-700/50 text-center flex flex-col items-center justify-center">
                    <div className="text-slate-500 text-[8px] font-bold">{axis}</div>
                    <div className="text-xs font-mono font-bold text-blue-300">{val}</div>
                  </div>
                ))}
              </div>
              
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="bg-slate-900/30 rounded-md border border-slate-700/50 p-2.5 flex flex-col items-center justify-center text-center">
                   <BarChart3 className="w-4 h-4 text-blue-400 mb-1" />
                   <div>
                     <div className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">mag_v</div>
                     <div className="text-[9px] font-black text-blue-300">{sensorData.magValue}</div>
                   </div>
                </div>
                <div className={`flex flex-col items-center justify-center text-center p-2.5 rounded-md border ${sensorData.isWaterCover ? 'bg-blue-600/10 border-blue-500/30' : 'bg-slate-900/30 border-slate-700/50'}`}>
                   <Zap className={`w-4 h-4 mb-1 ${sensorData.isWaterCover ? 'text-blue-400' : 'text-slate-600'}`} />
                   <div>
                     <div className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">Water</div>
                     <div className={`text-[9px] font-black ${sensorData.isWaterCover ? 'text-blue-300' : 'text-slate-400'}`}>{sensorData.isWaterCover ? 'YES' : 'NO'}</div>
                   </div>
                </div>
                <div className={`flex flex-col items-center justify-center text-center p-2.5 rounded-md border ${sensorData.isHighMag ? 'bg-orange-600/10 border-orange-500/30' : 'bg-slate-900/30 border-slate-700/50'}`}>
                   <Activity className={`w-4 h-4 mb-1 ${sensorData.isHighMag ? 'text-orange-400' : 'text-slate-600'}`} />
                   <div>
                     <div className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">Mag</div>
                     <div className={`text-[9px] font-black ${sensorData.isHighMag ? 'text-orange-300' : 'text-slate-400'}`}>{sensorData.isHighMag ? 'HIGH' : 'NORM'}</div>
                   </div>
                </div>
              </div>
            </div>

            {operationStatus && (
              <div className="bg-blue-600/10 border border-blue-500/30 rounded-md p-3 flex items-center gap-2 animate-in fade-in">
                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                <span className="text-xs font-bold text-blue-200">{operationStatus}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={handleCalibrate} 
                disabled={isOperating}
                className={`bg-blue-600 active:scale-95 disabled:opacity-50 text-white py-3 rounded-md font-bold transition-all shadow-md flex items-center justify-center gap-2 border border-blue-400/20 text-xs uppercase`}
              >
                <Compass className="w-4 h-4" />
                Calibrate
              </button>
              <button 
                onClick={handleReboot}
                disabled={isOperating}
                className={`bg-slate-700 active:scale-95 disabled:opacity-50 text-slate-200 py-3 rounded-md font-bold transition-all flex items-center justify-center gap-2 border border-slate-600 text-xs uppercase`}
              >
                <RotateCcw className="w-4 h-4" />
                Reboot
              </button>
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-5 space-y-4 shadow-md">
              <div className="flex items-center justify-between border-b border-slate-700/50 pb-3">
                <h3 className="text-slate-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                  <Settings className="w-3 h-3 text-blue-400" /> General Params
                </h3>
              </div>
              
              <div className="space-y-2">
                <label className="text-slate-400 text-[8px] font-black uppercase tracking-widest">Radar Module Status</label>
                <div className="flex gap-2">
                   <button 
                     onClick={() => { vibrate(); sendATCommand("AT+SWRDENABLE=1"); setTimeout(queryMainConfig, 500); }} 
                     className={`flex-1 py-3 rounded-md text-[10px] font-bold border transition-all ${config.radarEnabled ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/20 shadow-inner ring-1 ring-emerald-500/30' : 'bg-slate-900/40 text-slate-500 border-slate-700'}`}
                   >
                     ENABLED (ON)
                   </button>
                   <button 
                     onClick={() => { vibrate(); sendATCommand("AT+SWRDENABLE=0"); setTimeout(queryMainConfig, 500); }} 
                     className={`flex-1 py-3 rounded-md text-[10px] font-bold border transition-all ${!config.radarEnabled ? 'bg-rose-600/20 text-rose-400 border-rose-500/20 shadow-inner ring-1 ring-rose-500/30' : 'bg-slate-900/40 text-slate-500 border-slate-700'}`}
                   >
                     SLEEP (OFF)
                   </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-slate-400 text-[8px] font-black uppercase tracking-widest">Mounting Type</label>
                <div className="flex bg-slate-900 p-1 rounded-md border border-slate-700/50">
                  <button 
                    onClick={() => { vibrate(); sendATCommand("AT+SWRDPARKTYPE=0"); setTimeout(queryMainConfig, 500); }} 
                    className={`flex-1 py-2.5 text-[10px] font-bold rounded-md transition-all ${config.parkingType === 'horizontal' ? 'bg-blue-600 text-white shadow' : 'text-slate-500'}`}
                  >
                    HORIZONTAL
                  </button>
                  <button 
                    onClick={() => { vibrate(); sendATCommand("AT+SWRDPARKTYPE=1"); setTimeout(queryMainConfig, 500); }} 
                    className={`flex-1 py-2.5 text-[10px] font-bold rounded-md transition-all ${config.parkingType === 'vertical' ? 'bg-blue-600 text-white shadow' : 'text-slate-500'}`}
                  >
                    VERTICAL
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-slate-400 text-[8px] font-black uppercase tracking-widest">Detect Range (cm)</label>
                <div className="flex gap-1.5">
                   <div className="relative flex-1">
                     <input 
                       type="number" 
                       value={config.targetThreshold} 
                       onChange={(e) => setConfig({...config, targetThreshold: parseInt(e.target.value) || 0})} 
                       className="w-full bg-slate-900 border border-slate-700 text-white rounded-md pl-3 pr-8 py-2.5 text-xs font-bold focus:ring-1 focus:ring-blue-500 outline-none" 
                     />
                     <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-slate-500 font-bold uppercase">cm</span>
                   </div>
                   <button onClick={() => { sendATCommand(`AT+SWRDTARTH=${config.targetThreshold}`); setTimeout(queryMainConfig, 500); }} className="px-5 bg-blue-600 text-white rounded-md font-bold text-[10px] uppercase transition-all active:scale-95 shadow-lg border border-blue-400/20">Set</button>
                </div>
                <p className="text-[8px] text-slate-500 italic">* Restart device to apply range changes.</p>
              </div>
              
              <button onClick={queryMainConfig} className="w-full py-2.5 text-[9px] font-black text-slate-400 bg-slate-900/40 border border-slate-700 rounded-md hover:text-blue-400 active:bg-slate-700/30 transition-all uppercase tracking-widest flex items-center justify-center gap-2">
                <RefreshCw className={`w-3.5 h-3.5 ${isOperating ? 'animate-spin' : ''}`} /> Refresh Config
              </button>
            </div>

            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden shadow-md">
              <div className="flex border-b border-slate-700 bg-slate-800/50">
                <button 
                  onClick={() => { vibrate(); setConfigSubTab('lora'); queryLoraConfig(); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-[9px] font-black uppercase tracking-widest transition-all ${configSubTab === 'lora' ? 'text-blue-400 bg-blue-400/5 border-b-2 border-blue-400' : 'text-slate-500'}`}
                >
                  <Radio className="w-3.5 h-3.5" /> LoRaWAN
                </button>
                <button 
                  onClick={() => { vibrate(); setConfigSubTab('nbiot'); queryNbiotConfig(); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-[9px] font-black uppercase tracking-widest transition-all ${configSubTab === 'nbiot' ? 'text-blue-400 bg-blue-400/5 border-b-2 border-blue-400' : 'text-slate-500'}`}
                >
                  <Globe className="w-3.5 h-3.5" /> NB-IoT
                </button>
              </div>
              <div className="p-4">
                {configSubTab === 'lora' ? renderLoraTab() : renderNbiotTab()}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="flex flex-col h-[65vh] animate-in slide-in-from-bottom-2 duration-300">
            <div className="bg-slate-800 px-4 py-2 rounded-t-lg border border-slate-700 flex justify-between items-center shadow-md">
              <span className="text-[8px] font-black text-slate-500 flex items-center gap-1.5 uppercase tracking-widest">
                <Terminal className="w-2.5 h-2.5" /> Terminal Output
              </span>
              <button onClick={() => { vibrate(); setLogs([]); }} className="text-[9px] font-black text-blue-400 hover:text-blue-300 uppercase">Clear</button>
            </div>
            <div className="flex-1 bg-slate-950/90 backdrop-blur-sm border-x border-b border-slate-700 rounded-b-lg p-3 overflow-y-auto font-mono text-[9px] space-y-1">
              {logs.length === 0 && <div className="text-slate-700 text-center mt-10 italic">No activity yet.</div>}
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2 border-b border-slate-900 pb-0.5">
                  <span className="text-slate-600 shrink-0">{log.timestamp.split(':').slice(1).join(':')}</span>
                  <span className={`${log.type === 'tx' ? 'text-blue-400' : log.type === 'rx' ? 'text-emerald-400' : log.type === 'error' ? 'text-rose-500' : 'text-slate-500'} break-all`}>
                    {log.type === 'tx' ? '>' : log.type === 'rx' ? '<' : '!'} {log.message}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-1.5">
               <input 
                 id="custom-cmd" 
                 type="text" 
                 placeholder="Enter AT Command..." 
                 className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white text-[10px] font-mono focus:ring-1 focus:ring-blue-500 outline-none" 
                 onKeyDown={(e) => { if (e.key === 'Enter') { sendATCommand(e.currentTarget.value); e.currentTarget.value = ''; } }} 
               />
               <button onClick={() => { vibrate(); const input = document.getElementById('custom-cmd') as HTMLInputElement; if(input.value) { sendATCommand(input.value); input.value = ''; } }} className="bg-blue-600 text-white px-5 rounded-md font-bold text-[10px] uppercase shadow-lg active:scale-95 transition-transform border border-blue-400/20">SEND</button>
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 flex items-center justify-around px-1 py-1 safe-bottom z-50 shadow-2xl">
        {[
          { id: 'status', icon: LayoutDashboard, label: 'STATUS' },
          { id: 'config', icon: Settings, label: 'CONFIG' },
          { id: 'logs', icon: Clock, label: 'LOGS' }
        ].map((tab) => (
          <button 
            key={tab.id}
            onClick={() => { vibrate(); setActiveTab(tab.id as any); }}
            className={`flex flex-col items-center gap-0.5 px-6 py-2.5 rounded-md transition-all ${activeTab === tab.id ? 'bg-blue-600/10 text-blue-400' : 'text-slate-500 active:scale-95'}`}
          >
            <tab.icon className={`w-4.5 h-4.5 ${activeTab === tab.id ? 'text-blue-400' : 'opacity-60'}`} />
            <span className="text-[9px] font-bold tracking-tighter">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);