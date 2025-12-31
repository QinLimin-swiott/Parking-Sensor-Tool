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
  Wifi
} from 'lucide-react';

// --- Types & Constants ---

// UUIDs from the reference code
// Service: 0xfff0
// Notify (Read): 0xfff1
// Write: 0xfff2
const SERVICE_UUID = 0xfff0;
const NOTIFY_CHAR_UUID = 0xfff1;
const WRITE_CHAR_UUID = 0xfff2;

// --- Web Bluetooth Interfaces ---
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
  // Status flags
  isHighMag: boolean;
  isLowBattery: boolean;
  isWaterCover: boolean;
  isLowRssi: boolean;
}

// --- Helper Functions ---

const getTimeString = () => new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });

// String to Uint8Array for AT commands
const strToBytes = (str: string): Uint8Array => {
  const encoder = new TextEncoder();
  return encoder.encode(str);
};

// Uint8Array to String for responses
const bytesToStr = (value: DataView): string => {
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(value);
};

const hexStringToBytes = (hexStr: string): Uint8Array | null => {
  if (hexStr.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < hexStr.length; i += 2) {
      bytes[i / 2] = parseInt(hexStr.substr(i, 2), 16);
  }
  return bytes;
};

// --- Components ---

const App = () => {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'status' | 'config' | 'logs'>('status');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Sensor State
  const [sensorData, setSensorData] = useState<SensorData>({
    occupied: false,
    battery: 0,
    temperature: 0,
    magValue: 0,
    rssi: 0,
    coverValue: 0,
    distance: 0,
    parkCount: 0,
    isHighMag: false,
    isLowBattery: false,
    isWaterCover: false,
    isLowRssi: false,
  });

  const [config, setConfig] = useState<DeviceConfig>({
    parkingType: 'horizontal',
    targetThreshold: 30,
    coverThreshold: 100,
  });

  // BLE References
  const writeCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null);

  // Logging Helper
  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev.slice(-99), { timestamp: getTimeString(), type, message }]);
  };

  // --- Data Parsing Logic ---

  const processDeviceData = (str: string) => {
    try {
      // Format: +SWQUERY:HEX_DATA
      const parts = str.trim().split(':');
      if (parts.length < 2) return;
      
      const hexData = parts[1].replace(/\r?\n/g, "");
      const bytes = hexStringToBytes(hexData);
      
      if (!bytes || bytes.length < 13) {
        addLog('error', 'Invalid data length received');
        return;
      }

      // 1. Parse Fields
      const pcbTemp = bytes[0]; // Byte 0: Temp
      const batSoc = bytes[1];  // Byte 1: Battery %
      const statusByte = bytes[2]; // Byte 2: Status Bitmask
      const parkCnt = bytes[3]; // Byte 3: Parking Count
      
      // Multi-byte fields (Little Endian)
      const magValue = bytes[5] | (bytes[6] << 8);
      const rssiValue = bytes[7] | (bytes[8] << 8);
      const coverValue = bytes[9] | (bytes[10] << 8);
      const distanceValue = bytes[11] | (bytes[12] << 8);

      // 2. Parse Status Bits
      // Bit 1: High Mag, Bit 2: Low Bat, Bit 3: Water, Bit 4: Occupied, Bit 6: Low RSSI
      const isHighMag = (statusByte & (1 << 1)) !== 0;
      const isLowBattery = (statusByte & (1 << 2)) !== 0;
      const isWaterCover = (statusByte & (1 << 3)) !== 0;
      const isOccupied = (statusByte & (1 << 4)) !== 0;
      const isLowRssi = (statusByte & (1 << 6)) !== 0;

      // 3. Update State
      setSensorData({
        occupied: isOccupied,
        battery: batSoc,
        temperature: pcbTemp,
        magValue,
        rssi: rssiValue,
        coverValue,
        distance: distanceValue,
        parkCount: parkCnt,
        isHighMag,
        isLowBattery,
        isWaterCover,
        isLowRssi
      });

      addLog('info', `Parsed: Temp=${pcbTemp}, Bat=${batSoc}%, Occ=${isOccupied}`);

    } catch (e) {
      console.error(e);
      addLog('error', 'Failed to parse sensor data');
    }
  };

  const handleATResponse = (response: string) => {
    const cleanStr = response.trim();
    if (cleanStr.startsWith('+SWQUERY:')) {
      processDeviceData(cleanStr);
    } else if (cleanStr.startsWith('+SWRDTARTH:')) {
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

  // --- BLE Logic ---

  const connectDevice = async () => {
    setErrorMsg(null);
    try {
      if (!(navigator as any).bluetooth) {
        throw new Error("Web Bluetooth is not supported.");
      }

      // Use specific 0xfff0 service from reference code
      addLog('info', 'Scanning for SWIOTT devices...');
      
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true, 
        // Note: Reference used filters: [{namePrefix: "3"}] and optionalServices: [0xfff0]
        // We use acceptAllDevices for broader compatibility but MUST request the service
        optionalServices: [SERVICE_UUID] 
      });

      setDevice(device);
      addLog('info', `Connecting to ${device.name || 'Device'}...`);

      device.addEventListener('gattserverdisconnected', onDisconnected);

      const server = await device.gatt?.connect();
      if (!server) throw new Error("GATT Connection failed");
      serverRef.current = server;

      addLog('info', 'Finding Service 0xFFF0...');
      const service = await server.getPrimaryService(SERVICE_UUID);

      addLog('info', 'Finding Characteristics...');
      const notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID);
      const writeChar = await service.getCharacteristic(WRITE_CHAR_UUID);
      
      writeCharRef.current = writeChar;

      // Start Notifications
      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', (event: any) => {
        const str = bytesToStr(event.target.value);
        addLog('rx', str);
        handleATResponse(str);
      });

      setIsConnected(true);
      setIsDemoMode(false);
      
      // HANDSHAKE from reference code
      addLog('info', 'Sending Handshake: SWIOTT');
      await writeChar.writeValueWithoutResponse(strToBytes("SWIOTT"));
      
      // Fetch initial data
      setTimeout(() => sendATCommand("AT+SWQUERY?"), 500);
      setTimeout(() => sendATCommand("AT+SWRDTARTH?"), 800);

    } catch (error: any) {
      setErrorMsg(error.message || "Connection failed");
      addLog('error', `Error: ${error.message}`);
    }
  };

  const disconnectDevice = () => {
    if (serverRef.current) serverRef.current.disconnect();
    onDisconnected();
  };

  const onDisconnected = () => {
    setIsConnected(false);
    setIsDemoMode(false);
    setDevice(null);
    writeCharRef.current = null;
    serverRef.current = null;
    addLog('info', 'Disconnected');
  };

  const sendATCommand = async (cmd: string) => {
    if (isDemoMode) {
      addLog('tx', cmd);
      return;
    }
    if (!writeCharRef.current) return;

    try {
      const fullCmd = cmd.endsWith('\r\n') ? cmd : cmd + '\r\n';
      await writeCharRef.current.writeValueWithoutResponse(strToBytes(fullCmd));
      addLog('tx', fullCmd.trim());
    } catch (e: any) {
      addLog('error', `Send error: ${e.message}`);
    }
  };

  // --- Demo Mode ---

  const startDemoMode = () => {
    setIsConnected(true);
    setIsDemoMode(true);
    
    const interval = setInterval(() => {
      setSensorData(prev => ({
        ...prev,
        occupied: Math.random() > 0.5,
        magValue: Math.floor(Math.random() * 500),
        rssi: -60 - Math.floor(Math.random() * 20),
        temperature: 25 + Math.floor(Math.random() * 5),
        battery: 98
      }));
    }, 3000);
    return () => clearInterval(interval);
  };

  useEffect(() => {
    if (isDemoMode) {
      const cleanup = startDemoMode();
      return cleanup;
    }
  }, [isDemoMode]);

  // --- UI Renders ---

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900">
        <div className="max-w-md w-full bg-slate-800 rounded-2xl shadow-xl border border-slate-700 p-8 text-center">
          <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Bluetooth className="w-10 h-10 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">SWIOTT Sensor Tool</h1>
          <p className="text-slate-400 mb-8">
            Connect to parking sensor (Service 0xFFF0)
          </p>
          
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-900/30 border border-red-500/30 rounded-xl flex items-start gap-3 text-left">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">{errorMsg}</p>
            </div>
          )}

          <div className="space-y-3">
            <button 
              onClick={connectDevice}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <BluetoothConnected className="w-5 h-5" />
              Connect Device
            </button>
            <button 
              onClick={() => setIsDemoMode(true)}
              className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <Activity className="w-5 h-5" />
              Try Demo Mode
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 pb-20">
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <Car className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-white text-lg leading-tight">
                {isDemoMode ? 'Demo Device' : (device?.name || 'SWIOTT Sensor')}
              </h1>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs text-emerald-400 font-medium tracking-wider">CONNECTED</span>
              </div>
            </div>
          </div>
          <button onClick={disconnectDevice} className="p-2 bg-slate-700 hover:bg-red-500/20 text-slate-400 rounded-lg">
            <BluetoothOff className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-4">
        {/* Navigation */}
        <div className="grid grid-cols-3 gap-2 bg-slate-800 p-1 rounded-xl">
          {['status', 'config', 'logs'].map((tab: any) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-2 px-4 rounded-lg text-sm font-medium transition-all capitalize ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* STATUS TAB */}
        {activeTab === 'status' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            {/* Occupancy Card */}
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl text-center relative overflow-hidden">
               <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <Car className="w-40 h-40" />
              </div>
              
              <div className={`w-32 h-32 mx-auto rounded-full flex items-center justify-center mb-4 border-8 transition-colors duration-500 ${sensorData.occupied ? 'border-rose-500/30 bg-rose-500/10' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
                {sensorData.occupied ? (
                  <XCircle className="w-16 h-16 text-rose-500" />
                ) : (
                  <CheckCircle2 className="w-16 h-16 text-emerald-500" />
                )}
              </div>
              <h2 className={`text-2xl font-bold mb-1 ${sensorData.occupied ? 'text-rose-400' : 'text-emerald-400'}`}>
                {sensorData.occupied ? 'OCCUPIED' : 'VACANT'}
              </h2>
              <div className="text-slate-500 text-xs">Distance: {sensorData.distance}m</div>
              
              <div className="grid grid-cols-3 gap-4 border-t border-slate-700 pt-6 mt-6">
                <div>
                   <div className="text-slate-500 text-xs mb-1">Battery</div>
                   <div className="text-white font-bold flex items-center justify-center gap-1">
                     <Battery className={`w-4 h-4 ${sensorData.isLowBattery ? 'text-red-500' : 'text-emerald-500'}`} />
                     {sensorData.battery}%
                   </div>
                </div>
                 <div className="border-l border-slate-700">
                   <div className="text-slate-500 text-xs mb-1">Temp</div>
                   <div className="text-white font-bold">{sensorData.temperature}°C</div>
                </div>
                 <div className="border-l border-slate-700">
                   <div className="text-slate-500 text-xs mb-1">RSSI</div>
                   <div className="text-white font-bold flex items-center justify-center gap-1">
                     <Wifi className={`w-4 h-4 ${sensorData.isLowRssi ? 'text-yellow-500' : 'text-blue-500'}`} />
                     {sensorData.rssi}
                   </div>
                </div>
              </div>
            </div>

            {/* Sensor Flags */}
            <div className="grid grid-cols-2 gap-3">
              <div className={`p-3 rounded-xl border flex items-center gap-3 ${sensorData.isHighMag ? 'bg-rose-900/20 border-rose-500/30' : 'bg-slate-800 border-slate-700'}`}>
                <Activity className={`w-5 h-5 ${sensorData.isHighMag ? 'text-rose-400' : 'text-slate-500'}`} />
                <div>
                  <div className="text-xs text-slate-500">Magnetic Field</div>
                  <div className={`text-sm font-bold ${sensorData.isHighMag ? 'text-rose-300' : 'text-slate-300'}`}>
                    {sensorData.magValue} ({sensorData.isHighMag ? 'High' : 'Normal'})
                  </div>
                </div>
              </div>
              <div className={`p-3 rounded-xl border flex items-center gap-3 ${sensorData.isWaterCover ? 'bg-blue-900/20 border-blue-500/30' : 'bg-slate-800 border-slate-700'}`}>
                <Zap className={`w-5 h-5 ${sensorData.isWaterCover ? 'text-blue-400' : 'text-slate-500'}`} />
                <div>
                  <div className="text-xs text-slate-500">Water Cover</div>
                  <div className={`text-sm font-bold ${sensorData.isWaterCover ? 'text-blue-300' : 'text-slate-300'}`}>
                    {sensorData.isWaterCover ? 'Detected' : 'None'}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => sendATCommand("AT+SWQUERY?")}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Refresh Data
              </button>
              <button 
                onClick={() => sendATCommand("AT+SWRDCALI")}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-medium transition-colors"
              >
                Calibrate
              </button>
            </div>
          </div>
        )}

        {/* CONFIG TAB */}
        {activeTab === 'config' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 space-y-6">
              
              {/* Radar Controls */}
              <div className="flex gap-2 pb-6 border-b border-slate-700">
                 <button onClick={() => sendATCommand("AT+SWREBOOT")} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm">
                   Reboot Radar
                 </button>
                 <button onClick={() => sendATCommand("AT+SWRDENABLE=1")} className="flex-1 bg-blue-900/40 text-blue-300 border border-blue-500/30 hover:bg-blue-900/60 py-2 rounded-lg text-sm">
                   Enable Radar
                 </button>
                 <button onClick={() => sendATCommand("AT+SWRDENABLE=0")} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm">
                   Disable
                 </button>
              </div>

              {/* Parking Type */}
              <div>
                <label className="text-slate-300 text-sm font-medium mb-2 block">Parking Space Type</label>
                <div className="flex bg-slate-900 p-1 rounded-lg">
                  <button 
                    onClick={() => {
                      setConfig({...config, parkingType: 'horizontal'});
                      sendATCommand("AT+SWRDPARKTYPE=0");
                    }}
                    className={`flex-1 py-2 text-sm rounded-md transition-colors ${config.parkingType === 'horizontal' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
                  >
                    Horizontal
                  </button>
                  <button 
                    onClick={() => {
                      setConfig({...config, parkingType: 'vertical'});
                      sendATCommand("AT+SWRDPARKTYPE=1");
                    }}
                    className={`flex-1 py-2 text-sm rounded-md transition-colors ${config.parkingType === 'vertical' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
                  >
                    Vertical
                  </button>
                </div>
              </div>

              {/* Thresholds */}
              <div className="space-y-4">
                <div>
                  <label className="text-slate-300 text-sm font-medium mb-1 block">Target Threshold</label>
                  <div className="flex gap-2">
                     <input 
                      type="number" 
                      value={config.targetThreshold}
                      onChange={(e) => setConfig({...config, targetThreshold: parseInt(e.target.value)})}
                      className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-2" 
                     />
                     <button 
                       onClick={() => sendATCommand(`AT+SWRDTARTH=${config.targetThreshold}`)}
                       className="px-4 bg-blue-600 text-white rounded-lg"
                     >
                       Set
                     </button>
                  </div>
                </div>
                <div>
                  <label className="text-slate-300 text-sm font-medium mb-1 block">Cover Threshold</label>
                  <div className="flex gap-2">
                     <input 
                      type="number" 
                      value={config.coverThreshold}
                      onChange={(e) => setConfig({...config, coverThreshold: parseInt(e.target.value)})}
                      className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-2" 
                     />
                     <button 
                       onClick={() => sendATCommand(`AT+SWRDAVGTH=${config.coverThreshold}`)}
                       className="px-4 bg-blue-600 text-white rounded-lg"
                     >
                       Set
                     </button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* LOGS TAB */}
        {activeTab === 'logs' && (
          <div className="flex flex-col h-[calc(100vh-250px)] animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-slate-800 p-2 rounded-t-xl border border-slate-700 flex justify-between items-center">
              <span className="text-xs font-mono text-slate-400 flex items-center gap-2">
                <Terminal className="w-3 h-3" /> AT Command Log
              </span>
              <button onClick={() => setLogs([])} className="text-xs text-blue-400 hover:text-white px-2">Clear</button>
            </div>
            <div className="flex-1 bg-slate-950 border-x border-b border-slate-700 rounded-b-xl p-4 overflow-y-auto font-mono text-xs space-y-1">
              {logs.length === 0 && <div className="text-slate-600 text-center mt-10">No logs...</div>}
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-600 shrink-0">[{log.timestamp}]</span>
                  <span className={`${log.type === 'tx' ? 'text-blue-400' : log.type === 'rx' ? 'text-emerald-400' : log.type === 'error' ? 'text-red-400' : 'text-slate-300'}`}>
                    {log.type === 'tx' ? '>> ' : log.type === 'rx' ? '<< ' : ''}
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
            
            <div className="mt-2 flex gap-2">
               <input 
                 id="custom-cmd"
                 type="text" 
                 placeholder="Type AT command (e.g. AT+SWQUERY?)"
                 className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') {
                     sendATCommand(e.currentTarget.value);
                     e.currentTarget.value = '';
                   }
                 }}
               />
               <button 
                 onClick={() => {
                   const input = document.getElementById('custom-cmd') as HTMLInputElement;
                   if(input.value) {
                     sendATCommand(input.value);
                     input.value = '';
                   }
                 }}
                 className="bg-blue-600 text-white px-4 rounded-lg"
               >
                 Send
               </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);