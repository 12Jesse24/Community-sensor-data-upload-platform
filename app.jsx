import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';

// 標準 Firebase 模組導入。
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, limit, onSnapshot, serverTimestamp } from 'firebase/firestore';

// --- 全局變數和 Firebase 設定 (Canvas 環境提供) ---

// 虛擬配置，用於在 Canvas 環境未提供真實 Firebase 配置時，確保應用程式不會提前退出。
const DUMMY_FIREBASE_CONFIG = {
    apiKey: "AIzaSyD-UMMY-K3Y", 
    projectId: "dummy-project-id" 
};

// 1. 修正 Firebase 路徑錯誤：清理 __app_id
const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
// 替換所有路徑分隔符 (/) 和點 (.)，確保 appId 被視為單一文件 ID。
const appId = rawAppId.replace(/\//g, '_').replace(/\./g, '-'); 
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// 安全解析 __firebase_config，若無效則使用虛擬配置
let parsedConfig = DUMMY_FIREBASE_CONFIG;
let isDummyConfig = true; // 新增變數追蹤是否為虛擬配置

if (typeof __firebase_config !== 'undefined' && __firebase_config.trim() !== '') {
    try {
        // 嘗試解析提供的配置
        parsedConfig = JSON.parse(__firebase_config);
        if (parsedConfig && parsedConfig.projectId && parsedConfig.apiKey) {
             isDummyConfig = false; // 只有在成功解析出有效配置時，才將其標記為非虛擬
        }
    } catch (e) {
        console.error("Firebase 配置解析失敗，使用虛擬配置。", e);
    }
}
const firebaseConfig = parsedConfig;


// --- ECharts React Hook ---
const useEcharts = (options, chartId) => {
    const chartRef = useRef(null);
    const chartInstance = useRef(null);

    useEffect(() => {
        if (!chartRef.current) return;

        // 銷毀舊實例以避免重複渲染
        if (chartInstance.current) {
            try { echarts.dispose(chartInstance.current); } catch (e) {}
        }
        
        try {
            // 使用 'dark' 主題
            chartInstance.current = echarts.init(chartRef.current, 'dark');
        } catch (error) {
            console.error("ECharts 初始化失敗:", error);
            return;
        }

        const resizeChart = () => {
            if (chartInstance.current) {
                chartInstance.current.resize();
            }
        };

        window.addEventListener('resize', resizeChart);

        return () => {
            window.removeEventListener('resize', resizeChart);
            if (chartInstance.current) {
                try { echarts.dispose(chartInstance.current); } catch (e) {}
                chartInstance.current = null;
            }
        };
    }, [chartId]);

    useEffect(() => {
        if (chartInstance.current && options && Object.keys(options).length > 0) {
            try {
                // setOption(options, true) 確保完整更新
                chartInstance.current.setOption(options, true);
                chartInstance.current.resize();
            } catch (error) {
                console.error("ECharts setOption 失敗:", error);
            }
        }
    }, [options]);
    
    return chartRef;
};

// --- ECharts 選項生成函數：PM2.5 趨勢圖 ---
const createPm25TrendOptions = (readings) => {
    // 限制顯示最近 15 筆數據
    const displayReadings = readings.slice(-15); 
    const timestamps = displayReadings.map(r => 
        // 修正時間戳檢查: 確保 seconds 屬性存在
        r.timestamp && r.timestamp.seconds ? new Date(r.timestamp.seconds * 1000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '載入中...'
    );
    const pm25Values = displayReadings.map(r => r.pm25);
    const locations = displayReadings.map(r => r.location);

    return {
        // 設定圖表整體間距
        grid: { top: '10%', left: '3%', right: '4%', bottom: '3%', containLabel: true },
        tooltip: {
            trigger: 'axis',
            formatter: function (params) {
                const data = params[0];
                const index = data.dataIndex;
                const reading = displayReadings[index];
                let tooltip = `時間: ${data.name}<br/>`;
                tooltip += `地點: ${locations[index]}<br/>`;
                tooltip += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${data.color};"></span>PM2.5: <strong>${data.value} µg/m³</strong>`;
                return tooltip;
            }
        },
        xAxis: {
            type: 'category',
            data: timestamps,
            name: '上傳時間',
            axisLabel: { color: '#9CA3AF' }
        },
        yAxis: {
            type: 'value',
            name: 'PM2.5 (µg/m³)',
            min: 0,
            max: 100, // 假設上限
            splitLine: { lineStyle: { color: '#374151' } },
            axisLabel: { color: '#9CA3AF' }
        },
        series: [
            {
                name: 'PM2.5 數值',
                type: 'line',
                smooth: true,
                data: pm25Values,
                lineStyle: { color: '#34D399' },
                itemStyle: { color: '#34D399' },
                areaStyle: {
                    opacity: 0.8,
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: '#34D399' }, // 綠色
                        { offset: 1, color: '#1F2937' }  // 灰色背景
                    ])
                }
            }
        ]
    };
};


// --- ECharts 選項生成函數：溫度與濕度比較圖 ---
const createTempHumidityOptions = (readings) => {
    const displayReadings = readings.slice(-10); // 最近 10 筆
    const timestamps = displayReadings.map(r => 
        // 修正時間戳檢查
        r.timestamp && r.timestamp.seconds ? new Date(r.timestamp.seconds * 1000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '載入中...'
    );
    const tempValues = displayReadings.map(r => r.temperature);
    const humidityValues = displayReadings.map(r => r.humidity);

    return {
        // 設定圖表整體間距
        grid: { top: '15%', left: '3%', right: '4%', bottom: '3%', containLabel: true },
        tooltip: { trigger: 'axis' },
        legend: {
            data: ['溫度 (°C)', '濕度 (%)'],
            textStyle: { color: '#E5E7EB' }
        },
        xAxis: {
            type: 'category',
            data: timestamps,
            name: '時間',
            axisLabel: { color: '#9CA3AF' }
        },
        yAxis: [
            {
                type: 'value',
                name: '溫度 (°C)',
                min: 0,
                max: 40,
                axisLabel: { formatter: '{value} °C', color: '#F87171' },
                splitLine: { lineStyle: { color: '#374151' } }
            },
            {
                type: 'value',
                name: '濕度 (%)',
                min: 0,
                max: 100,
                axisLabel: { formatter: '{value} %', color: '#60A5FA' },
                splitLine: { show: false }
            }
        ],
        series: [
            {
                name: '溫度 (°C)',
                type: 'bar',
                data: tempValues,
                itemStyle: { color: '#F87171' }
            },
            {
                name: '濕度 (%)',
                type: 'line',
                yAxisIndex: 1,
                data: humidityValues,
                itemStyle: { color: '#60A5FA' },
                lineStyle: { color: '#60A5FA' }
            }
        ]
    };
};

// --- 感測器數據上傳模擬器 (Modal Component) ---
const SensorUploaderModal = ({ isOpen, onClose, onUpload, userId }) => {
    // 隨機生成初始值
    const [location, setLocation] = useState('社區北門');
    const [temp, setTemp] = useState((25 + Math.random() * 5).toFixed(1));
    const [humidity, setHumidity] = useState((60 + Math.random() * 10).toFixed(1));
    const [pm25, setPm25] = useState(Math.floor(15 + Math.random() * 20));

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        onUpload({
            location,
            temperature: parseFloat(temp),
            humidity: parseFloat(humidity),
            pm25: parseFloat(pm25),
            userId: userId,
        });
        onClose();
    };
    
    // 隨機生成新數據
    const generateRandomData = () => {
        setLocation(Math.random() > 0.5 ? '社區北門' : '社區活動中心');
        setTemp((20 + Math.random() * 15).toFixed(1));
        setHumidity((45 + Math.random() * 35).toFixed(1));
        setPm25(Math.floor(Math.random() * 80) + 5);
    };

    const InputField = ({ label, value, setter, unit, color }) => (
        <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
                <span className={`font-bold ${color}`}>{label}</span> ({unit}):
            </label>
            <input
                type={unit === '地點' ? 'text' : 'number'}
                min="0"
                step={unit === '地點' ? null : "0.1"}
                value={value}
                onChange={(e) => setter(e.target.value)}
                className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-blue-500 focus:border-blue-500"
            />
        </div>
    );

    return (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex justify-center items-center z-50 p-4 transition-opacity duration-300">
            <div className="bg-gray-800 p-6 rounded-xl shadow-2xl w-full max-w-md transform transition-transform duration-300 scale-100 border border-indigo-600">
                <h3 className="text-2xl font-bold text-indigo-400 mb-4 border-b border-gray-700 pb-2">
                    模擬感測器數據上傳
                </h3>
                <form onSubmit={handleSubmit}>
                    <InputField label="上傳者/地點" value={location} setter={setLocation} unit="地點" color="text-yellow-400" />
                    <InputField label="溫度" value={temp} setter={setTemp} unit="°C" color="text-red-400" />
                    <InputField label="濕度" value={humidity} setter={setHumidity} unit="%" color="text-blue-400" />
                    <InputField label="PM2.5" value={pm25} setter={setPm25} unit="µg/m³" color="text-green-400" />

                    <div className="mt-6 flex justify-between space-x-3">
                        <button
                            type="button"
                            onClick={generateRandomData}
                            className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition duration-200"
                        >
                            🔄 隨機生成數據
                        </button>
                        <div className="flex space-x-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition duration-200"
                            >
                                取消
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition duration-200 shadow-md"
                            >
                                📡 上傳數據到平台
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- 主應用程式元件 ---
const App = () => {
    // Firebase 狀態
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    // 應用程式數據狀態
    const [readings, setReadings] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    // 初始化錯誤狀態，使用 isDummyConfig 判斷是否顯示警告
    const [loadingError, setLoadingError] = useState(isDummyConfig 
        ? "⚠️ 警告：無法讀取真實配置，正在使用虛擬配置。資料庫操作可能失敗。" 
        : null
    );

    // 1. Firebase 初始化和認證
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            // 處理認證狀態
            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (!user) {
                    // 初始 token 存在時，嘗試使用 Custom Token 登入
                    if (initialAuthToken) {
                        try {
                            await signInWithCustomToken(firebaseAuth, initialAuthToken);
                        } catch (e) {
                            console.warn("Custom token sign-in failed, falling back to anonymous.", e);
                            await signInAnonymously(firebaseAuth);
                        }
                    } else {
                        // 初始 token 不存在時，直接匿名登入
                        await signInAnonymously(firebaseAuth);
                    }
                }
                
                // 再次檢查狀態，獲取最終的 userId
                const currentUser = firebaseAuth.currentUser;
                // 使用 currentUser.uid 作為唯一的 userId，如果仍未登入則使用隨機 ID
                setUserId(currentUser?.uid || 'anonymous-user-' + crypto.randomUUID().substring(0, 8));
                setIsAuthReady(true);
                
                // 如果是虛擬配置，保持警告狀態，否則清除可能的舊錯誤
                if (!isDummyConfig) {
                    setLoadingError(null);
                }
            });

            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase 初始化失敗:", error);
            // 無論是否為虛擬配置，只要初始化失敗就顯示嚴重錯誤
            setLoadingError(`🔴 錯誤: Firebase 初始化失敗: ${error.message} (可能由於配置無效或不存在)`);
        }
    }, []);

    // 2. 數據訂閱 (在認證完成後執行)
    useEffect(() => {
        if (!isAuthReady || !db || isDummyConfig) {
            // 如果是虛擬配置，不進行數據庫讀取，只在 UI 上顯示警告
            if (isDummyConfig) console.warn("使用虛擬配置，跳過 Firestore 數據訂閱。");
            return;
        }

        // Firestore 路徑：/artifacts/{appId}/public/data/community_sensors
        const collectionPath = `/artifacts/${appId}/public/data/community_sensors`;
        // 為了避免因缺乏索引而產生錯誤，我們移除 orderBy，改為在客戶端排序。
        const q = query(collection(db, collectionPath), limit(20));

        // 設置即時監聽
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const newReadings = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                // 確保 timestamp 是一個可讀取的物件，而不是一個未解析的物件
                timestamp: doc.data().timestamp, 
            }));
            
            // 在客戶端進行排序 (從舊到新)
            const sortedReadings = newReadings.sort((a, b) => {
                // 檢查 timestamp 是否為 Firestore Timestamp 物件
                const timeA = a.timestamp && a.timestamp.seconds ? a.timestamp.seconds : 0;
                const timeB = b.timestamp && b.timestamp.seconds ? b.timestamp.seconds : 0;
                return timeA - timeB;
            });

            setReadings(sortedReadings); 
        }, (error) => {
            console.error("Firestore 數據訂閱失敗:", error);
            // 只有在不是虛擬配置的情況下才顯示錯誤
            setLoadingError(`🔴 錯誤: 數據加載失敗: ${error.message} (檢查防火牆規則或連線)`);
        });

        return () => unsubscribe();
    }, [isAuthReady, db, appId, isDummyConfig]); // 確保 isDummyConfig 納入依賴

    // 3. 數據上傳處理函數
    const handleUpload = async (sensorData) => {
        if (!db || isDummyConfig) {
            console.error("Firestore 尚未初始化或使用虛擬配置，無法上傳。");
            setLoadingError("🔴 錯誤: 無法上傳：數據庫未就緒或配置無效。");
            return;
        }
        
        try {
            const collectionPath = `/artifacts/${appId}/public/data/community_sensors`;
            await addDoc(collection(db, collectionPath), {
                ...sensorData,
                timestamp: serverTimestamp(), // 使用伺服器時間戳
            });
            console.log("數據上傳成功!");
        } catch (error) {
            console.error("數據上傳失敗:", error);
            setLoadingError(`🔴 錯誤: 數據上傳失敗: ${error.message} (請確認 Firebase 配置是否有效)`);
        }
    };

    // 渲染相關 ECharts
    const pm25Options = createPm25TrendOptions(readings);
    const tempHumidityOptions = createTempHumidityOptions(readings);

    const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;

    // --- UI 渲染 ---
    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 p-4 sm:p-8 font-sans">
            <header className="mb-6">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-indigo-400 mb-2">
                    社區感測器資料上傳平台
                </h1>
                <p className="text-gray-400">即時環境數據監測與共享 ({isAuthReady ? (userId?.startsWith('anonymous-user-') ? '✅ 匿名連接' : '✅ 已連接') : '⏳ 連接中...'})</p>
                <p className="text-xs text-gray-500 mt-1">當前使用者 ID: <span className="font-mono text-gray-400">{userId || 'N/A'}</span></p>
            </header>

            {/* 根據錯誤類型顯示紅色錯誤或黃色警告 */}
            {loadingError && (
                <div className={`${loadingError.includes('錯誤:') ? 'bg-red-900/40 text-red-300 border-red-600' : 'bg-yellow-900/40 text-yellow-300 border-yellow-600'} p-4 rounded-lg mb-6 border`}>
                    {loadingError}
                </div>
            )}

            {/* 上傳按鈕 */}
            <div className="mb-8">
                <button
                    onClick={() => setIsModalOpen(true)}
                    // <<< 修正點：移除 isDummyConfig 檢查，只依賴認證完成 >>>
                    disabled={!isAuthReady} 
                    className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg transition duration-300 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    + 模擬上傳感測器數據
                </button>
            </div>

            {/* 數據總覽卡片 */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                <DataCard 
                    title="最新溫度" 
                    value={latestReading?.temperature || 'N/A'} 
                    unit="°C" 
                    color="text-red-400"
                    description={latestReading?.location || '無數據'}
                />
                <DataCard 
                    title="最新濕度" 
                    value={latestReading?.humidity || 'N/A'} 
                    unit="%" 
                    color="text-blue-400"
                    description={latestReading?.location || '無數據'}
                />
                <DataCard 
                    title="最新 PM2.5" 
                    value={latestReading?.pm25 || 'N/A'} 
                    unit="µg/m³" 
                    color={latestReading && latestReading.pm25 > 50 ? 'text-yellow-400' : 'text-green-400'}
                    description={latestReading?.location || '無數據'}
                />
                <DataCard 
                    title="數據總筆數" 
                    value={readings.length} 
                    unit="筆 (最近20筆)" 
                    color="text-purple-400"
                    description="即時從 Firestore 讀取"
                />
            </div>

            {/* 圖表網格 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartContainer
                    options={pm25Options}
                    id="pm25-trend-chart"
                    title="PM2.5 趨勢 (最近 15 筆)"
                />
                <ChartContainer
                    options={tempHumidityOptions}
                    id="temp-humidity-chart"
                    title="溫度與濕度比較 (最近 10 筆)"
                />
            </div>

            {/* 原始數據列表 */}
            <LatestDataList readings={readings} />
            
            <footer className="mt-12 text-center text-gray-600 border-t border-gray-800 pt-6">
                <p>專案模擬：社區感測器資料平台 (Firestore 即時共享)</p>
            </footer>

            {/* 模態框元件：只要認證準備好，就可以打開模態框 */}
            {isAuthReady && userId && (
                <SensorUploaderModal 
                    isOpen={isModalOpen} 
                    onClose={() => setIsModalOpen(false)} 
                    onUpload={handleUpload} 
                    userId={userId}
                />
            )}
        </div>
    );
};

// --- 輔助 UI 元件：單一數據卡片 ---
const DataCard = ({ title, value, unit, color, description }) => (
    <div className="bg-gray-800 p-5 rounded-xl shadow-xl border-t-4 border-indigo-500">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">{title}</h3>
        <p className={`text-4xl font-extrabold mt-1 ${color}`}>
            {value}
            <span className="text-base font-normal ml-1 text-gray-400">{unit}</span>
        </p>
        <p className="text-xs text-gray-500 mt-2 truncate">地點: {description}</p>
    </div>
);

// --- 輔助 UI 元件：圖表容器 ---
const ChartContainer = ({ options, id, title }) => {
    const chartRef = useEcharts(options, id); 
    return (
        <div className="bg-gray-800 p-4 rounded-xl shadow-xl h-full flex flex-col">
            <h3 className="text-white text-lg font-semibold mb-2 border-b border-gray-700 pb-2">{title}</h3>
            <div ref={chartRef} className="flex-grow min-h-[350px] w-full" style={{ height: '350px' }} id={id} />
        </div>
    );
};

// --- 輔助 UI 元件：最新數據列表 ---
const LatestDataList = ({ readings }) => {
    // 顯示最新的 5 筆數據
    const latestFive = readings.slice(-5).reverse(); 

    if (latestFive.length === 0) {
        return (
            <div className="bg-gray-800 p-6 rounded-xl shadow-xl mt-6 text-center text-gray-400">
                目前沒有感測器數據，請點擊 "模擬上傳感測器數據" 按鈕新增。
            </div>
        );
    }

    return (
        <div className="bg-gray-800 p-6 rounded-xl shadow-xl mt-6">
            <h3 className="text-white text-xl font-semibold mb-4 border-b border-gray-700 pb-2">
                最新感測器數據 (原始記錄)
            </h3>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-700">
                    <thead>
                        <tr className="text-left text-gray-400 uppercase text-sm">
                            <th className="px-4 py-2">上傳時間</th>
                            <th className="px-4 py-2">地點</th>
                            <th className="px-4 py-2">溫度 (°C)</th>
                            <th className="px-4 py-2">濕度 (%)</th>
                            <th className="px-4 py-2">PM2.5 (µg/m³)</th>
                            <th className="px-4 py-2">上傳者 ID (部分)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {latestFive.map((r, index) => (
                            <tr key={r.id || index} className="text-gray-300 hover:bg-gray-700 transition duration-150">
                                {/* 修正: 確保 r.timestamp.seconds 存在 */}
                                <td className="px-4 py-3 font-mono text-xs">{r.timestamp && r.timestamp.seconds ? new Date(r.timestamp.seconds * 1000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '載入中...'}</td>
                                <td className="px-4 py-3 font-medium">{r.location || 'N/A'}</td>
                                <td className="px-4 py-3 text-red-400">{r.temperature?.toFixed(1) || 'N/A'}</td>
                                <td className="px-4 py-3 text-blue-400">{r.humidity?.toFixed(1) || 'N/A'}</td>
                                <td className="px-4 py-3 text-green-400">{r.pm25 || 'N/A'}</td>
                                <td className="px-4 py-3 font-mono text-xs">{r.userId?.substring(0, 8) || 'N/A'}...</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default App;
