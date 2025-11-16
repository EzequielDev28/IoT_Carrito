// --- 1. Configuración Global EXCLUSIVA AWS ---
const isGitHubPages = true;
const API_BASE_URL = 'https://100.26.151.211:443/api';
const WS_BASE_URL = 'wss://100.26.151.211:443';

console.log(`🌐 Entorno: AWS EC2 Instance`);
console.log(`🔗 API: ${API_BASE_URL}`);
console.log(`🔗 WebSocket: ${WS_BASE_URL}`);

let DEVICE_NAME = document.getElementById('deviceInput').value || 'carrito-alpha';

let webSocket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 3000;

// Control de estado del carrito
let carritoEstado = {
    moviendose: false,
    movimientoActual: null,
    timeoutMovimiento: null
};

// Control de ejecución de secuencias
let ejecucionSecuencia = {
    activa: false,
    secuenciaId: null,
    pasos: [],
    pasoActual: 0,
    totalPasos: 0,
    timeoutPasos: [],
    inicioEjecucion: null,
    pausada: false,
    pasoInterrumpido: null,
    tiempoRestantePaso: 0
};

// Datos de Ubicación y Hora en Tiempo Real
let ubicacionReal = {
    ip: 'Desconocida',
    pais: 'Desconocido',
    ciudad: 'Desconocida',
    lat: null,
    lon: null,
    timestamp: null
};

// Mapeo de operaciones y obstáculos a claves
const OPERACION_MAP = {
    'Adelante': 1,
    'Atras': 2,
    'Detener': 3,
    'Vuelta adelante derecha': 4,
    'Vuelta adelante izquierda': 5,
    'Vuelta atrás derecha': 6,
    'Vuelta atrás izquierda': 7,
    'Giro 90° derecha': 8,
    'Giro 90° izquierda': 9,
    'Giro 360° derecha': 10,
    'Giro 360° izquierda': 11
};

const OBSTACULO_MAP = {
    'Adelante': 1,
    'Adelante-Izquierda': 2,
    'Adelante-Derecha': 3,
    'Adelante-Izquierda-Derecha': 4,
    'Retrocede': 5
};

// --- 2. WebSocket Nativo ---
// --- 2. WebSocket Único con Múltiples Canales ---
function connectWebSocket() {
    const url = `${WS_BASE_URL}/ws`;
    
    try {
        webSocket = new WebSocket(url);
        
        webSocket.onopen = function(event) {
            console.log('✅ WebSocket Único CONECTADO');
            reconnectAttempts = 0;
            updateWSStatus('movement', 'connected');
            updateWSStatus('obstacle', 'connected');
            logToWS('CONN', 'Conectado al servidor WebSocket único');
            showAlert('WebSocket único conectado', 'success');
            
            // Suscribirse a ambos canales
            subscribeToChannel('movement');
            subscribeToChannel('obstacle');
            
            // Cargar datos iniciales
            loadMovementLogs();
            loadObstacleLogs();
        };
        
        webSocket.onclose = function(event) {
            console.log('❌ WebSocket Único CERRADO:', event.code, event.reason);
            updateWSStatus('movement', 'disconnected');
            updateWSStatus('obstacle', 'disconnected');
            logToWS('CONN', `Conexión cerrada: ${event.code} - ${event.reason}`);
            
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                console.log(`🔄 Reintentando conexión (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                setTimeout(connectWebSocket, RECONNECT_DELAY);
            }
        };
        
        webSocket.onerror = function(error) {
            console.error('❌ Error en WebSocket Único:', error);
            updateWSStatus('movement', 'error');
            updateWSStatus('obstacle', 'error');
            logToWS('CONN', 'Error de conexión');
        };
        
        webSocket.onmessage = function(event) {
    try {
        const data = JSON.parse(event.data);
        console.log('📡 Mensaje recibido del canal:', data.channel, 'Tipo:', data.type);
        
        // DEBUG DETALLADO TEMPORAL
        console.log('🔍 Estructura completa del mensaje:', {
            channel: data.channel,
            type: data.type,
            device_name: data.device_name,
            data_keys: data.data ? Object.keys(data.data) : 'No data'
        });
        
        // ENRUTAR MENSAJES SEGÚN EL CANAL
        if (data.channel === 'movement') {
            logToWS('MOV', `Tipo: ${data.type}`);
            handleMovementEvent(data);
        } else if (data.channel === 'obstacle') {
            logToWS('OBS', `Tipo: ${data.type}`);
            handleObstacleEvent(data);
        } else if (data.type === 'subscription_confirmed') {
            logToWS('SUB', `Suscripción confirmada: ${data.channel}`);
            console.log(`✅ Suscrito al canal: ${data.channel}`);
        } else if (data.type === 'latest') {
            console.log(`📥 Mensaje 'latest' recibido para canal: ${data.channel}`);
            // Los mensajes 'latest' también deben ser procesados por sus handlers
            if (data.channel === 'movement') {
                handleMovementEvent(data);
            } else if (data.channel === 'obstacle') {
                handleObstacleEvent(data);
            }
        } else {
            console.log('❓ Mensaje no manejado:', data);
            logToWS('UNK', `Mensaje no manejado: ${data.channel} - ${data.type}`);
        }
        
    } catch (error) {
        console.error('❌ Error parseando mensaje WebSocket:', error);
        console.error('📄 Contenido del mensaje que causó error:', event.data);
        logToWS('ERR', `Error parseando: ${error.message}`);
    }
};
        
    } catch (error) {
        console.error('❌ Error creando WebSocket único:', error);
        updateWSStatus('movement', 'error');
        updateWSStatus('obstacle', 'error');
    }
}

// Función para suscribirse a un canal específico
function subscribeToChannel(channel) {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        const subscribeMessage = {
            action: "subscribe",
            channel: channel,
            device_name: DEVICE_NAME
        };
        webSocket.send(JSON.stringify(subscribeMessage));
        console.log(`📨 Suscribiéndose al canal: ${channel}`);
    }
}


function updateWSStatus(type, status) {
    const element = document.getElementById(`ws${type.charAt(0).toUpperCase() + type.slice(1)}Status`);
    if (!element) return;
    
    switch(status) {
        case 'connected':
            element.textContent = 'Conectado';
            element.className = 'fw-bold text-success';
            break;
        case 'disconnected':
            element.textContent = 'Desconectado';
            element.className = 'fw-bold text-danger';
            break;
        case 'error':
            element.textContent = 'Error';
            element.className = 'fw-bold text-warning';
            break;
        default:
            element.textContent = 'Desconocido';
            element.className = 'fw-bold text-secondary';
    }
}

function disconnectWebSockets() {
     if (webSocket) {
        webSocket.close();
        webSocket = null;
    }
}

// --- 3. Utilidades de UI y Manejo de API ---

function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.setAttribute('role', 'alert');
    alertDiv.innerHTML = `
        <i class="bi bi-${type === 'success' ? 'check-circle' : type === 'danger' ? 'x-octagon' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;

    alertContainer.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) {
            const bsAlert = bootstrap.Alert.getOrCreateInstance(alertDiv);
            bsAlert.close();
        }
    }, 5000);
}

function logToWS(type, message) {
    const wsLog = document.getElementById('wsLog');
    const now = new Date().toLocaleTimeString();
    const logEntry = `<p class="small mb-1">[${now}] [${type}] ${message}</p>`;
    
    const currentLogs = wsLog.innerHTML;
    const logsArray = currentLogs.split('</p>').filter(log => log.trim() !== '');
    logsArray.unshift(logEntry);
    
    if (logsArray.length > 10) {
        logsArray.length = 10;
    }
    
    wsLog.innerHTML = logsArray.join('</p>') + '</p>';
}

// --- 4. Funciones de Ubicación y Tiempo ---

async function obtenerIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        console.warn('No se pudo obtener la IP:', error);
        return 'Desconocida';
    }
}

function obtenerTimestampActual() {
    const now = new Date();
    return now.toLocaleString('es-MX', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

function obtenerDatosUbicacion() {
    return {
        ip: ubicacionReal.ip,
        pais: ubicacionReal.pais,
        ciudad: ubicacionReal.ciudad,
        latitud: ubicacionReal.lat,
        longitud: ubicacionReal.lon,
        timestamp: obtenerTimestampActual()
    };
}

// --- 5. Funciones de API REST ---

async function postData(endpoint, data) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.details || response.statusText);
        }

        return response.json();

    } catch (error) {
        showAlert(`Error en POST a ${endpoint}: ${error.message}`, 'danger');
        console.error('Error en POST:', endpoint, error);
        return null;
    }
}

async function fetchData(endpoint) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.details || response.statusText);
        }

        return response.json();

    } catch (error) {
        showAlert(`Error en GET a ${endpoint}: ${error.message}`, 'danger');
        console.error('Error en GET:', endpoint, error);
        return null;
    }
}

// --- 6. Controladores de Eventos ---

// Caches locales
let movementCache = [];
let obstacleCache = [];

function handleMovementEvent(eventData) {
    // SOLO MOVIMIENTOS - estructura: {type, channel, device_name, data: {...}}
    if (!eventData || eventData.channel !== 'movement' || !eventData.data) {
        console.log('❌ Evento de movimiento ignorado - canal incorrecto o sin datos');
        return;
    }
    
    console.log('🔄 Procesando evento de MOVIMIENTO:', eventData.data);
    const movementData = eventData.data;
    
    // Validar que sea realmente un movimiento
    if (!movementData.operacion_clave && !movementData.operacion_texto) {
        console.log('❌ No es un movimiento válido (sin operacion_clave u operacion_texto):', movementData);
        return;
    }
    
    if (!movementData.id) {
        console.log('❌ Datos de movimiento inválidos (sin ID):', movementData);
        return;
    }
    
    const existingIndex = movementCache.findIndex(m => m.id === movementData.id);
    if (existingIndex >= 0) {
        movementCache[existingIndex] = movementData;
        console.log('📝 Movimiento actualizado en cache');
    } else {
        movementCache.unshift(movementData);
        console.log('📝 Nuevo movimiento agregado al cache');
    }
    
    if (movementCache.length > 50) {
        movementCache = movementCache.slice(0, 50);
    }
    
    console.log('📊 Cache de MOVIMIENTOS actualizado. Total:', movementCache.length);
    updateMovementDisplay();
}
function handleObstacleEvent(eventData) {
    // SOLO OBSTÁCULOS - estructura: {type, channel, device_name, data: {...}}
    if (!eventData || eventData.channel !== 'obstacle' || !eventData.data) {
        console.log('❌ Evento de obstáculo ignorado - canal incorrecto o sin datos');
        return;
    }
    
    console.log('🔄 Procesando evento de OBSTÁCULO:', eventData.data);
    const obstacleData = eventData.data;
    
    // Validar que sea realmente un obstáculo
    if (!obstacleData.obstaculo_clave && !obstacleData.obstaculo_texto) {
        console.log('❌ No es un obstáculo válido (sin obstaculo_clave u obstaculo_texto):', obstacleData);
        return;
    }
    
    if (!obstacleData.id) {
        console.log('❌ Datos de obstáculo inválidos (sin ID):', obstacleData);
        return;
    }
    
    const existingIndex = obstacleCache.findIndex(o => o.id === obstacleData.id);
    if (existingIndex >= 0) {
        obstacleCache[existingIndex] = obstacleData;
        console.log('📝 Obstáculo actualizado en cache');
    } else {
        obstacleCache.unshift(obstacleData);
        console.log('📝 Nuevo obstáculo agregado al cache');
    }
    
    if (obstacleCache.length > 50) {
        obstacleCache = obstacleCache.slice(0, 50);
    }
    
    console.log('📊 Cache de OBSTÁCULOS actualizado. Total:', obstacleCache.length);
    updateObstacleDisplay();
}

// Operaciones que soportan velocidad (solo Adelante y Atrás)
const OPERACIONES_CON_VELOCIDAD = [1, 2]; // 1: Adelante, 2: Atrás
function sendMovement(op_clave) {
    const op_name = Object.keys(OPERACION_MAP).find(key => OPERACION_MAP[key] === op_clave);
    
    // Obtener velocidad seleccionada solo para operaciones que la soportan
    let velocidad = 0;
    if (OPERACIONES_CON_VELOCIDAD.includes(op_clave)) {
        const speedSelector = document.getElementById('speedSelector');
        velocidad = speedSelector ? parseInt(speedSelector.value) : 75;
        console.log(`🚀 Movimiento ${op_name} con velocidad: ${velocidad}`);
    } else {
        console.log(`↪️ Movimiento especial ${op_name} - sin control de velocidad`);
    }
    
    // Limpiar timeout de movimiento anterior si existe
    if (carritoEstado.timeoutMovimiento) {
        clearTimeout(carritoEstado.timeoutMovimiento);
        carritoEstado.timeoutMovimiento = null;
    }
    
    const datosUbicacion = obtenerDatosUbicacion();
    
    const data = {
        device_name: DEVICE_NAME,
        operacion: op_clave,
        speed: velocidad,
        ip: datosUbicacion.ip,
        pais: datosUbicacion.pais,
        ciudad: datosUbicacion.ciudad,
        latitud: datosUbicacion.latitud,
        longitud: datosUbicacion.longitud,
        event_at: datosUbicacion.timestamp
    };
    
    console.log('📤 Enviando movimiento con datos:', data);
    
    postData('/movement/', data).then(result => {
        if (result) {
            if (op_clave === 1 || op_clave === 2) {
                // MOVIMIENTOS CONTINUOS: Adelante y Atrás
                carritoEstado.moviendose = true;
                carritoEstado.movimientoActual = op_clave;
                
                console.log(`▶️ Movimiento ${op_name} iniciado (continuo hasta detener)`);
                showAlert(`Movimiento ${op_name} iniciado - Se mantendrá hasta enviar "Detener"`, 'info');
                
            } else if (op_clave === 3) {
                // DETENER - Limpiar estado de movimiento continuo
                carritoEstado.moviendose = false;
                carritoEstado.movimientoActual = null;
                
                console.log('🛑 Movimiento detenido manualmente');
                showAlert('Movimiento detenido', 'warning');
                
            } else {
                // MOVIMIENTOS ESPECIALES (giros, vueltas) - se ejecutan una vez
                console.log(`↪️ Movimiento especial ejecutado: ${op_name}`);
                
                // Para movimientos especiales, podemos agregar un pequeño feedback visual
                // pero no afectan el estado de movimiento continuo
                setTimeout(() => {
                    showAlert(`Movimiento especial completado: ${op_name}`, 'success');
                }, 500);
            }
        }
    });
}

function sendObstacle(obst_clave) {
    const obst_name = Object.keys(OBSTACULO_MAP).find(key => OBSTACULO_MAP[key] === obst_clave);
    
    const datosUbicacion = obtenerDatosUbicacion();
    
    const data = {
        device_name: DEVICE_NAME,
        obstaculo: obst_clave,
        ip: datosUbicacion.ip,
        pais: datosUbicacion.pais,
        ciudad: datosUbicacion.ciudad,
        latitud: datosUbicacion.latitud,
        longitud: datosUbicacion.longitud,
        event_at: datosUbicacion.timestamp
    };

    postData('/obstacle/', data).then(result => {
        const resultDiv = document.getElementById('obstacleResult');
        resultDiv.classList.remove('hidden');
        
        if (result) {
            showAlert(`Obstáculo registrado: ${obst_name}`, 'success');
            resultDiv.innerHTML = `
                <strong class="text-warning">Obstáculo:</strong> ${result.obstaculo_texto || 'N/D'}<br>
                <strong class="text-info">Sugerencia:</strong> ${result.sugerencia_texto || 'N/A'}
            `;
            
            if (ejecucionSecuencia.activa && !ejecucionSecuencia.pausada) {
                interrumpirSecuenciaPorObstaculo(result);
            } else if (carritoEstado.moviendose) {
                detenerPorObstaculo();
            }
            
        } else {
            resultDiv.innerHTML = `<span class="text-danger">Error al registrar obstáculo</span>`;
        }
    });
}

function detenerPorObstaculo() {
    if (carritoEstado.moviendose) {
        console.log('🚫 Obstáculo detectado - Deteniendo movimiento en curso');
        
        // Limpiar timeout si existe
        if (carritoEstado.timeoutMovimiento) {
            clearTimeout(carritoEstado.timeoutMovimiento);
            carritoEstado.timeoutMovimiento = null;
        }
        
        // Enviar comando de detener
        sendMovement(3);
        
        showAlert('¡Obstáculo detectado! Movimiento detenido automáticamente', 'warning');
        
        carritoEstado.moviendose = false;
        carritoEstado.movimientoActual = null;
    }
}

function interrumpirSecuenciaPorObstaculo(obstaculoData) {
    if (!ejecucionSecuencia.activa || ejecucionSecuencia.pausada) return;
    
    console.log('🚫 OBSTÁCULO - Interrumpiendo secuencia en curso');
    
    ejecucionSecuencia.pausada = true;
    const pasoActual = ejecucionSecuencia.pasos[ejecucionSecuencia.pasoActual];
    ejecucionSecuencia.pasoInterrumpido = ejecucionSecuencia.pasoActual;
    
    const tiempoTranscurrido = new Date() - ejecucionSecuencia.inicioEjecucion;
    const tiempoTotalPasos = ejecucionSecuencia.pasos.slice(0, ejecucionSecuencia.pasoActual)
        .reduce((sum, paso) => sum + paso.duracion_ms, 0);
    const tiempoTranscurridoPaso = tiempoTranscurrido - tiempoTotalPasos;
    ejecucionSecuencia.tiempoRestantePaso = Math.max(0, pasoActual.duracion_ms - tiempoTranscurridoPaso);
    
    ejecucionSecuencia.timeoutPasos.forEach(timeout => clearTimeout(timeout));
    ejecucionSecuencia.timeoutPasos = [];
    
    // Detener cualquier movimiento continuo del carrito
    if (carritoEstado.moviendose) {
        sendMovement(3);
    }
    
    agregarLogEjecucion(`🚫 SECUENCIA INTERRUMPIDA - Obstáculo detectado: ${obstaculoData.obstaculo_texto}`);
    agregarLogEjecucion(`💡 Sugerencia: ${obstaculoData.sugerencia_texto}`);
    
    showAlert('¡Obstáculo detectado! Secuencia interrumpida para evasión', 'warning');
    
    procesarEvasionObstaculo(obstaculoData);
}

function procesarEvasionObstaculo(obstaculoData) {
    const sugerencia = obstaculoData.sugerencia_texto;
    
    console.log(`🔄 Procesando evasión: ${sugerencia}`);
    agregarLogEjecucion(`🔄 Ejecutando evasión: ${sugerencia}`);
    
    const evasionMap = {
        'Detener': 3,
        'Retroceder': 2,
        'Girar a la izquierda': 9,
        'Girar a la derecha': 8,
        'Avanzar con precaución': 1
    };
    
    let movimientoEvasion = 3;
    
    for (const [key, value] of Object.entries(evasionMap)) {
        if (sugerencia.includes(key)) {
            movimientoEvasion = value;
            break;
        }
    }
    
    console.log(`↪️ Ejecutando movimiento de evasión: ${movimientoEvasion}`);
    
    setTimeout(() => {
        sendMovement(movimientoEvasion);
        
        setTimeout(() => {
            reanudarSecuenciaDespuesObstaculo();
        }, 2000);
        
    }, 500);
}

function reanudarSecuenciaDespuesObstaculo() {
    if (!ejecucionSecuencia.activa || !ejecucionSecuencia.pausada) return;
    
    console.log('🔄 REANUDANDO secuencia después de evasión de obstáculo');
    agregarLogEjecucion('🔄 REANUDANDO secuencia después de evasión');
    
    ejecucionSecuencia.pausada = false;
    ejecucionSecuencia.inicioEjecucion = new Date();
    ejecucionSecuencia.pasoActual = ejecucionSecuencia.pasoInterrumpido + 1;
    ejecucionSecuencia.pasoInterrumpido = null;
    ejecucionSecuencia.tiempoRestantePaso = 0;
    
    if (ejecucionSecuencia.pasoActual < ejecucionSecuencia.totalPasos) {
        agregarLogEjecucion(`▶️ Reanudando desde paso ${ejecucionSecuencia.pasoActual + 1}`);
        ejecutarSiguientePaso();
    } else {
        finalizarEjecucionSecuencia();
    }
    
    showAlert('Secuencia reanudada después de evasión de obstáculo', 'success');
}

// --- 7. Funciones de Monitoreo y UI ---

function changeTab(tabId) {
    if (tabId === 'monitor') {
        if (movementCache.length === 0) {
            loadMovementLogs();
        }
        if (obstacleCache.length === 0) {
            loadObstacleLogs();
        }
    }
}

function updateDeviceName(newName) {
    if (newName && newName !== DEVICE_NAME) {
        const oldName = DEVICE_NAME;
        DEVICE_NAME = newName;
        
        showAlert(`Cambiando dispositivo de ${oldName} a ${DEVICE_NAME}. Reconectando WS...`, 'info');
        
        // LIMPIAR CACHES COMPLETAMENTE
        movementCache = [];
        obstacleCache = [];
        
        clearMonitoringDisplays();
        
        // DESCONECTAR Y RECONECTAR
        disconnectWebSockets();
        setTimeout(() => {
            connectWebSocket(); // ← CONECTAR NUEVAMENTE
        }, 1000);
    }
}

function clearMonitoringDisplays() {
    document.getElementById('lastMovement').innerHTML = '<p class="text-secondary">Cargando...</p>';
    document.getElementById('last10Movements').innerHTML = '<p class="text-secondary">Cargando...</p>';
    document.getElementById('lastObstacle').innerHTML = '<p class="text-secondary">Cargando...</p>';
    document.getElementById('last10Obstacles').innerHTML = '<p class="text-secondary">Cargando...</p>';
}

function updateMovementDisplay() {
    const lastMovDiv = document.getElementById('lastMovement');
    const last10MovDiv = document.getElementById('last10Movements');
    
    if (!lastMovDiv || !last10MovDiv) {
        console.log('❌ Elementos de UI de movimientos no encontrados');
        return;
    }
    
    console.log('🔄 Actualizando UI de movimientos. Cache:', movementCache.length, 'elementos');
    
    if (movementCache.length > 0) {
        const lastMovement = movementCache[0];
        const last10Movements = movementCache.slice(0, 10);
        
        console.log('📝 Mostrando último movimiento:', lastMovement.operacion_texto || lastMovement.operacion);
        console.log('📝 Mostrando últimos 10 movimientos:', last10Movements.length);
        
        lastMovDiv.innerHTML = formatLogData(lastMovement);
        last10MovDiv.innerHTML = formatLogData(last10Movements, true);
        
        // Efecto visual de actualización
        lastMovDiv.style.transition = 'background-color 0.3s';
        lastMovDiv.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        setTimeout(() => {
            lastMovDiv.style.backgroundColor = '';
        }, 1000);
        
    } else {
        console.log('📝 No hay movimientos en cache para mostrar');
        lastMovDiv.innerHTML = '<p class="text-secondary small">No hay movimientos recientes</p>';
        last10MovDiv.innerHTML = '<p class="text-secondary small">No hay movimientos para mostrar</p>';
    }
}

function updateObstacleDisplay() {
    const lastObstDiv = document.getElementById('lastObstacle');
    const last10ObstDiv = document.getElementById('last10Obstacles');
    
    if (!lastObstDiv || !last10ObstDiv) {
        console.log('❌ Elementos de UI de obstáculos no encontrados');
        return;
    }
    
    console.log('🔄 Actualizando UI de obstáculos. Cache:', obstacleCache.length, 'elementos');
    
    if (obstacleCache.length > 0) {
        const lastObstacle = obstacleCache[0];
        const last10Obstacles = obstacleCache.slice(0, 10);
        
        console.log('📝 Mostrando último obstáculo:', lastObstacle.obstaculo_texto || lastObstacle.obstaculo);
        console.log('📝 Mostrando últimos 10 obstáculos:', last10Obstacles.length);
        
        lastObstDiv.innerHTML = formatLogData(lastObstacle);
        last10ObstDiv.innerHTML = formatLogData(last10Obstacles, true);
        
        // Efecto visual de actualización
        lastObstDiv.style.transition = 'background-color 0.3s';
        lastObstDiv.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
        setTimeout(() => {
            lastObstDiv.style.backgroundColor = '';
        }, 1000);
        
    } else {
        console.log('📝 No hay obstáculos en cache para mostrar');
        lastObstDiv.innerHTML = '<p class="text-secondary small">No hay obstáculos recientes</p>';
        last10ObstDiv.innerHTML = '<p class="text-secondary small">No hay obstáculos para mostrar</p>';
    }
}

function formatLogData(data, isList = false) {
    if (!data || (isList && data.length === 0)) {
        return `<p class="text-secondary small">No hay registros para ${DEVICE_NAME}.</p>`;
    }
    
    const list = isList ? data : [data];
    let html = '';
    
    list.forEach(item => {
        if (!item) return;
        
        // DIFERENCIAR CLARAMENTE ENTRE MOVIMIENTOS Y OBSTÁCULOS
        let operation, type, icon, textColor;
        
        // ES MOVIMIENTO si tiene operacion_clave u operacion_texto
        if (item.operacion_clave !== undefined || item.operacion_texto) {
            operation = item.operacion_texto || `Operación ${item.operacion_clave}` || 'N/A';
            type = 'MOVIMIENTO';
            icon = 'bi-arrow-right-circle';
            textColor = 'text-info';
        } 
        // ES OBSTÁCULO si tiene obstaculo_clave u obstaculo_texto
        else if (item.obstaculo_clave !== undefined || item.obstaculo_texto) {
            operation = item.obstaculo_texto || `Obstáculo ${item.obstaculo_clave}` || 'N/A';
            type = 'OBSTÁCULO';
            icon = 'bi-cone-striped';
            textColor = 'text-warning';
        } else {
            // Tipo desconocido - no mostrar
            console.log('❓ Elemento desconocido en formatLogData:', item);
            return;
        }
        
        const timeDetail = item.event_at ? 
            `Hace ${getTimeAgo(new Date(item.event_at))} (${new Date(item.event_at).toLocaleTimeString()})` : 
            item.scheduled_at ? 
            `Programado: ${new Date(item.scheduled_at).toLocaleString()}` : 
            'Sin timestamp';

        const locationDetail = (item.ciudad && item.pais) ? 
            `${item.ciudad}, ${item.pais}` : 
            (item.ip_cliente ? `IP: ${item.ip_cliente}` : '');

        // MOSTRAR VELOCIDAD SOLO PARA MOVIMIENTOS
        const speedDetail = (item.speed !== null && item.speed !== undefined && type === 'MOVIMIENTO') ? 
            `<br><i class="bi bi-speedometer2 me-1"></i>Velocidad: ${item.speed}` : '';

        // MOSTRAR SUGERENCIA SOLO PARA OBSTÁCULOS
        const suggestionDetail = (item.sugerencia_texto && type === 'OBSTÁCULO') ? 
            `<br><i class="bi bi-lightbulb me-1"></i>Sugerencia: ${item.sugerencia_texto}` : '';

        html += `<div class="py-2 border-bottom border-secondary">
            <p class="small fw-bold ${textColor} mb-1">
                <i class="bi ${icon} me-1"></i> [${type}] ${operation}
            </p>
            <p class="small text-secondary mb-0 ps-3">
                <i class="bi bi-clock me-1"></i>${timeDetail}
                ${speedDetail}
                ${suggestionDetail}
                ${item.latitud && item.longitud ? `<br><i class="bi bi-pin-map me-1"></i>${item.latitud.toFixed(4)}, ${item.longitud.toFixed(4)}` : ''}
                ${locationDetail ? `<br><i class="bi bi-geo-alt me-1"></i>${locationDetail}` : ''}
            </p>
            ${item.id ? `<p class="small text-muted mb-0 ps-3">ID: ${item.id}</p>` : ''}
        </div>`;
    });
    return html;
}

function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMs < 60000) return 'hace unos segundos';
    if (diffMins < 60) return `hace ${diffMins} minuto${diffMins > 1 ? 's' : ''}`;
    if (diffHours < 24) return `hace ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
    return `hace ${Math.floor(diffHours / 24)} días`;
}

async function loadMovementLogs() {
    const lastMovDiv = document.getElementById('lastMovement');
    const last10MovDiv = document.getElementById('last10Movements');
    
    if (!lastMovDiv || !last10MovDiv) return;
    
    lastMovDiv.innerHTML = '<p class="text-info small">Cargando último movimiento...</p>';
    last10MovDiv.innerHTML = '<p class="text-info small">Cargando últimos 10 movimientos...</p>';
    
    try {
        const lastMov = await fetchData(`/movement/${DEVICE_NAME}/last`);
        if (lastMov && !Array.isArray(lastMov)) {
            movementCache.unshift(lastMov);
        }
        
        const last10Mov = await fetchData(`/movement/${DEVICE_NAME}/last10`);
        if (last10Mov && Array.isArray(last10Mov)) {
            movementCache = [...last10Mov, ...movementCache.filter(m => 
                !last10Mov.find(lm => lm.id === m.id)
            )];
        }
        
        movementCache = movementCache.slice(0, 50);
        updateMovementDisplay();
        
    } catch (error) {
        console.error('Error cargando movimientos:', error);
        updateMovementDisplay();
    }
}

async function loadObstacleLogs() {
    const lastObstDiv = document.getElementById('lastObstacle');
    const last10ObstDiv = document.getElementById('last10Obstacles');
    
    if (!lastObstDiv || !last10ObstDiv) return;
    
    lastObstDiv.innerHTML = '<p class="text-info small">Cargando último obstáculo...</p>';
    last10ObstDiv.innerHTML = '<p class="text-info small">Cargando últimos 10 obstáculos...</p>';
    
    try {
        const lastObst = await fetchData(`/obstacle/${DEVICE_NAME}/last`);
        if (lastObst && !Array.isArray(lastObst)) {
            obstacleCache.unshift(lastObst);
        }
        
        const last10Obst = await fetchData(`/obstacle/${DEVICE_NAME}/last10`);
        if (last10Obst && Array.isArray(last10Obst)) {
            obstacleCache = [...last10Obst, ...obstacleCache.filter(o => 
                !last10Obst.find(lo => lo.id === o.id)
            )];
        }
        
        obstacleCache = obstacleCache.slice(0, 50);
        updateObstacleDisplay();
        
    } catch (error) {
        console.error('Error cargando obstáculos:', error);
        updateObstacleDisplay();
    }
}

// --- 8. Funciones para Demos ---
let manualSteps = [];

function addManualStep() {
    const op = parseInt(document.getElementById('manualOpSelect').value);
    const dur = parseInt(document.getElementById('manualDurInput').value);

    if (!op || !dur || dur <= 0) {
        return showAlert("Debes seleccionar una operación válida y una duración mayor a 0.", "warning");
    }

    manualSteps.push({ op, dur });
    updateManualStepsPreview();
}

function clearManualSteps() {
    manualSteps = [];
    updateManualStepsPreview();
}

function updateManualStepsPreview() {
    const preview = document.getElementById('manualStepsPreview');
    if (manualSteps.length === 0) {
        preview.innerHTML = '<p class="text-secondary small">Aún no hay pasos agregados.</p>';
        return;
    }

    preview.innerHTML = manualSteps
        .map((s, i) => `<div class="border-bottom border-secondary py-1">
            <span class="text-info">#${i + 1}</span> → Op: <b>${s.op}</b> | Dur: <b>${s.dur} ms</b>
        </div>`)
        .join('');
}

async function finalizeManualDemo() {
    if (manualSteps.length === 0) {
        return showAlert("No hay pasos en la demo manual.", "danger");
    }

    const data = {
        device_name: DEVICE_NAME,
        steps_json: JSON.stringify(manualSteps)
    };

    const result = await postData('/demo/manual/', data);

    if (result && result.secuencia) {
        showAlert(`Demo Manual ID ${result.secuencia.id} creada con ${manualSteps.length} pasos.`, 'success');
        manualSteps = [];
        updateManualStepsPreview();
        loadLast20Demos();
    }
}

async function createRandomDemo() {
    // Verificar que los elementos existen antes de acceder a ellos
    const nPasosElement = document.getElementById('nPasos');
    const minMsElement = document.getElementById('minMs');
    const maxMsElement = document.getElementById('maxMs');
    const excluirDetenerElement = document.getElementById('excluirDetener');

    if (!nPasosElement || !minMsElement || !maxMsElement || !excluirDetenerElement) {
        console.error('❌ No se pudieron encontrar los elementos de control de demo');
        showAlert('Error: No se pudieron cargar los controles de demo. Recarga la página.', 'danger');
        return;
    }

    const nPasos = parseInt(nPasosElement.value);
    const minMs = parseInt(minMsElement.value);
    const maxMs = parseInt(maxMsElement.value);
    const excluirDetener = excluirDetenerElement.checked;

    if (nPasos <= 0 || minMs <= 0 || maxMs <= 0 || minMs > maxMs) {
        return showAlert('Parámetros de Demo aleatoria inválidos.', 'danger');
    }

    const data = {
        device_name: DEVICE_NAME,
        n_pasos: nPasos,
        min_ms: minMs,
        max_ms: maxMs,
        excluir_detener: excluirDetener
    };

    console.log('🎲 Creando demo aleatoria con datos:', data);

    const results = await postData('/demo/random/', data);
    if (results && results.secuencia) {
        showAlert(`Demo Aleatoria ID ${results.secuencia.id} creada con ${results.secuencia.n_pasos} pasos.`, 'success');
        loadLast20Demos();
    } else {
        showAlert('Error al crear la demo aleatoria', 'danger');
    }
}

async function loadLast20Demos() {
    const demoListDiv = document.getElementById('demoList');
    demoListDiv.innerHTML = '<p class="text-info small">Cargando demos...</p>';
    
    const demos = await fetchData(`/demo/${DEVICE_NAME}/last20`);
    
    if (demos && Array.isArray(demos) && demos.length > 0) {
        demoListDiv.innerHTML = '';
        demos.forEach(demo => {
            const item = document.createElement('div');
            item.className = 'demo-item border-bottom border-secondary py-2 cursor-pointer';
            item.setAttribute('data-secuencia-id', demo.id);
            item.innerHTML = `
                <span class="fw-bold text-info">ID: ${demo.id}</span> | Pasos: ${demo.n_pasos}<br>
                <span class="text-secondary small">Creada: ${new Date(demo.creado_en).toLocaleString()}</span>
            `;
            item.onclick = () => repeatDemo(demo.id);
            demoListDiv.appendChild(item);
        });
    } else {
        demoListDiv.innerHTML = `<p class="text-secondary small">No se encontraron secuencias Demo para ${DEVICE_NAME}.</p>`;
    }
}

function repeatDemo(secuencia_id) {
    const endpoint = `/demo/repeat/${secuencia_id}/${DEVICE_NAME}/`;
    
    console.log(`🔄 Solicitando repetición de secuencia ID: ${secuencia_id}`);
    limpiarEjecucionSecuencia();
    
    postData(endpoint, {}).then(result => {
        if (result) {
            console.log('✅ Respuesta de repeat demo recibida:', result);
            
            // Debug de la estructura
            debugSecuencia(result);
            
            if (result.movimientos_programados) {
                debugTiemposSecuencia(result.movimientos_programados);
                
                showAlert(`Repitiendo secuencia ID ${secuencia_id}. Monitoreo iniciado...`, 'info');
                
                // Iniciar monitoreo inmediatamente - sin timeout
                iniciarMonitoreoSecuencia(
                    result.ejecucion?.id || secuencia_id, 
                    result.movimientos_programados
                );
            } else {
                console.error('❌ No hay movimientos programados en la respuesta:', result);
                showAlert('Error: La secuencia no tiene movimientos programados', 'danger');
            }
        } else {
            console.error('❌ Respuesta vacía o inválida de repeat demo');
            showAlert('Error: No se pudo obtener la secuencia', 'danger');
        }
    }).catch(error => {
        console.error('❌ Error en repeatDemo:', error);
        showAlert(`Error al repetir secuencia: ${error.message}`, 'danger');
    });
}

// --- 9. Funciones de Ejecución de Secuencias ---

function iniciarMonitoreoSecuencia(secuenciaId, movimientosProgramados) {
    if (!movimientosProgramados || movimientosProgramados.length === 0) {
        console.log('❌ No hay movimientos programados para monitorear');
        showAlert('No hay movimientos programados para monitorear', 'danger');
        return;
    }

    console.log('🎬 Iniciando monitoreo de secuencia con movimientos:', movimientosProgramados);

    // Limpiar ejecución anterior
    detenerEjecucionSecuencia();

    const pasosConDuracion = calcularDuraciones(movimientosProgramados);
    
    console.log('📋 Pasos con duración calculada:', pasosConDuracion);

    if (pasosConDuracion.length === 0) {
        console.error('❌ No se pudieron calcular duraciones para los pasos');
        showAlert('Error: No se pudieron calcular los tiempos de la secuencia', 'danger');
        return;
    }

    ejecucionSecuencia = {
        activa: true,
        secuenciaId: secuenciaId,
        pasos: pasosConDuracion,
        pasoActual: 0,
        totalPasos: pasosConDuracion.length,
        timeoutPasos: [],
        inicioEjecucion: new Date(),
        pausada: false,
        pasoInterrumpido: null,
        tiempoRestantePaso: 0
    };

    // Mostrar información de la secuencia
    mostrarInformacionSecuencia();
    
    // Iniciar el primer paso
    console.log(`🚀 Iniciando secuencia ID: ${secuenciaId} con ${pasosConDuracion.length} pasos`);
    agregarLogEjecucion(`🎬 SECUENCIA INICIADA - ID: ${secuenciaId} | Pasos: ${pasosConDuracion.length}`);
     // Actualizar UI
    actualizarUIEjecucionSecuencia();
    ejecutarSiguientePaso();
}

function calcularDuraciones(movimientos) {
    if (!movimientos || movimientos.length === 0) return [];
    
    const pasos = [];
    console.log('⏰ Calculando duraciones para movimientos:', movimientos.length);
    
    for (let i = 0; i < movimientos.length; i++) {
        const movimiento = movimientos[i];
        const scheduledAt = new Date(movimiento.scheduled_at);
        
        let duracion_ms = 2000; // Duración por defecto más larga
        
        if (i < movimientos.length - 1) {
            const nextScheduledAt = new Date(movimientos[i + 1].scheduled_at);
            duracion_ms = nextScheduledAt - scheduledAt;
            
            console.log(`   Paso ${i + 1}: ${movimiento.operacion_texto}`);
            console.log(`   - Scheduled: ${scheduledAt.toISOString()}`);
            console.log(`   - Next: ${nextScheduledAt.toISOString()}`);
            console.log(`   - Duración: ${duracion_ms}ms`);
            
            // Asegurar duración mínima y máxima razonable
            if (duracion_ms < 500) {
                console.log(`   ⚠️ Duración muy corta (${duracion_ms}ms), usando 2000ms por defecto`);
                duracion_ms = 2000;
            } else if (duracion_ms > 30000) {
                console.log(`   ⚠️ Duración muy larga (${duracion_ms}ms), usando 5000ms máximo`);
                duracion_ms = 5000;
            }
        } else {
            // Último movimiento - usar duración por defecto
            console.log(`   Último paso ${i + 1}: ${movimiento.operacion_texto} - Duración por defecto: ${duracion_ms}ms`);
        }
        
        pasos.push({
            operacion: movimiento.operacion_clave,
            duracion_ms: duracion_ms,
            scheduled_at: movimiento.scheduled_at,
            operacion_texto: movimiento.operacion_texto,
            movimiento_original: movimiento
        });
    }
    
    console.log('✅ Duraciones calculadas:', pasos);
    return pasos;
}

function ejecutarSiguientePaso() {
    // Verificar si la secuencia está pausada por obstáculo
    if (ejecucionSecuencia.pausada) {
        console.log('⏸️ Secuencia pausada, esperando reanudación...');
        return;
    }
    
    if (!ejecucionSecuencia.activa) {
        console.log('❌ Secuencia no activa, no se puede ejecutar siguiente paso');
        return;
    }
    
    if (ejecucionSecuencia.pasoActual >= ejecucionSecuencia.totalPasos) {
        console.log('🏁 Todos los pasos completados');
        finalizarEjecucionSecuencia();
        return;
    }

    const paso = ejecucionSecuencia.pasos[ejecucionSecuencia.pasoActual];
    const numeroPaso = ejecucionSecuencia.pasoActual + 1;
    
    // Validar datos del paso
    if (!paso.operacion || !paso.duracion_ms) {
        console.error('❌ Paso inválido:', paso);
        agregarLogEjecucion(`❌ ERROR: Paso ${numeroPaso} tiene datos inválidos. Saltando...`);
        ejecucionSecuencia.pasoActual++;
        setTimeout(() => ejecutarSiguientePaso(), 100);
        return;
    }
    
    // Mostrar el paso actual
    mostrarPasoActual(numeroPaso, paso);
    
    // Calcular tiempo restante total
    const tiempoRestante = calcularTiempoRestanteTotal();
    
    // Actualizar progreso
    actualizarProgreso(numeroPaso, tiempoRestante);
    
    // Log del paso ejecutado
    const operacionTexto = paso.operacion_texto || 
                          Object.keys(OPERACION_MAP).find(key => OPERACION_MAP[key] === paso.operacion) || 
                          `Operación ${paso.operacion}`;
    
    console.log(`▶️ Ejecutando paso ${numeroPaso}/${ejecucionSecuencia.totalPasos}: ${operacionTexto} (${paso.duracion_ms}ms)`);
    agregarLogEjecucion(`▶️ Paso ${numeroPaso}/${ejecucionSecuencia.totalPasos}: ${operacionTexto} (${Math.round(paso.duracion_ms)}ms)`);
    
    // Programar el siguiente paso
    const timeout = setTimeout(() => {
        // Verificar nuevamente si no está pausada antes de continuar
        if (!ejecucionSecuencia.pausada && ejecucionSecuencia.activa) {
            console.log(`✅ Paso ${numeroPaso} completado`);
            agregarLogEjecucion(`✅ Paso ${numeroPaso} completado`);
            ejecucionSecuencia.pasoActual++;
            ejecutarSiguientePaso();
        }
    }, paso.duracion_ms);

    ejecucionSecuencia.timeoutPasos.push(timeout);
}

function mostrarInformacionSecuencia() {
    const secuenciaInfo = document.getElementById('secuenciaInfo');
    const secuenciaIdActual = document.getElementById('secuenciaIdActual');
    const totalPasosSecuencia = document.getElementById('totalPasosSecuencia');
    
    if (!secuenciaInfo || !secuenciaIdActual || !totalPasosSecuencia) {
        console.error('❌ Elementos de información de secuencia no encontrados');
        return;
    }
    
    secuenciaInfo.classList.remove('hidden');
    secuenciaIdActual.textContent = ejecucionSecuencia.secuenciaId;
    totalPasosSecuencia.textContent = ejecucionSecuencia.totalPasos;
    
    console.log('📊 Información de secuencia mostrada:', {
        id: ejecucionSecuencia.secuenciaId,
        pasos: ejecucionSecuencia.totalPasos
    });
}
function mostrarPasoActual(numeroPaso, paso) {
    const pasoActualSecuencia = document.getElementById('pasoActualSecuencia');
    
    let operacionTexto = paso.operacion_texto;
    if (!operacionTexto && paso.operacion && OPERACION_MAP) {
        operacionTexto = Object.keys(OPERACION_MAP).find(key => OPERACION_MAP[key] === paso.operacion);
    }
    
    if (!operacionTexto) {
        operacionTexto = `Operación ${paso.operacion || 'N/A'}`;
    }
    
    const duracion = paso.duracion_ms ? Math.round(paso.duracion_ms) : 'N/A';
    pasoActualSecuencia.textContent = `${numeroPaso} - ${operacionTexto} (${duracion}ms)`;
}

function actualizarProgreso(pasoActual, tiempoRestante) {
    const barraProgreso = document.getElementById('barraProgresoSecuencia');
    const progresoTexto = document.getElementById('progresoTexto');
    const tiempoRestanteSecuencia = document.getElementById('tiempoRestanteSecuencia');
    const pasoActualSecuencia = document.getElementById('pasoActualSecuencia');
    
    if (!barraProgreso || !progresoTexto || !tiempoRestanteSecuencia || !pasoActualSecuencia) {
        console.error('❌ Elementos de progreso no encontrados');
        return;
    }
    
    const progreso = (pasoActual / ejecucionSecuencia.totalPasos) * 100;
    barraProgreso.style.width = `${progreso}%`;
    progresoTexto.textContent = `${Math.round(progreso)}%`;
    tiempoRestanteSecuencia.textContent = tiempoRestante;
    
    // Cambiar color de la barra según el progreso
    if (progreso < 50) {
        barraProgreso.className = 'progress-bar progress-bar-striped progress-bar-animated bg-warning';
    } else if (progreso < 100) {
        barraProgreso.className = 'progress-bar progress-bar-striped progress-bar-animated bg-info';
    } else {
        barraProgreso.className = 'progress-bar progress-bar-striped progress-bar-animated bg-success';
    }
    
    console.log(`📈 Progreso actualizado: ${Math.round(progreso)}% - Tiempo restante: ${tiempoRestante}`);
}

function calcularTiempoRestanteTotal() {
    if (!ejecucionSecuencia.activa) return '0s';
    
    let tiempoTotalRestante = 0;
    for (let i = ejecucionSecuencia.pasoActual; i < ejecucionSecuencia.totalPasos; i++) {
        tiempoTotalRestante += ejecucionSecuencia.pasos[i].duracion_ms;
    }
    
    if (tiempoTotalRestante < 100) {
        return '0s';
    }
    
    const segundos = Math.floor(tiempoTotalRestante / 1000);
    if (segundos < 60) {
        return `${segundos}s`;
    } else {
        const minutos = Math.floor(segundos / 60);
        const segundosRestantes = segundos % 60;
        return `${minutos}m ${segundosRestantes}s`;
    }
}

function agregarLogEjecucion(mensaje) {
    const logEjecucion = document.getElementById('logEjecucionSecuencia');
    const ahora = new Date();
    const timestamp = ahora.toLocaleTimeString() + '.' + ahora.getMilliseconds().toString().padStart(3, '0');
    
    const logEntry = document.createElement('div');
    logEntry.className = 'border-bottom border-secondary py-1 small';
    logEntry.innerHTML = `<span class="text-light">[${timestamp}]</span> ${mensaje}`;
    
    logEjecucion.prepend(logEntry);
    
    const entries = logEjecucion.querySelectorAll('div');
    if (entries.length > 15) {
        entries[entries.length - 1].remove();
    }
}

function finalizarEjecucionSecuencia() {
    if (ejecucionSecuencia.activa) {
        agregarLogEjecucion('✅ SECUENCIA COMPLETADA EXITOSAMENTE');
        showAlert(`Secuencia ${ejecucionSecuencia.secuenciaId} completada`, 'success');
    }
    
    ejecucionSecuencia.activa = false;
    actualizarProgreso(ejecucionSecuencia.totalPasos, '0s');
    document.getElementById('pasoActualSecuencia').textContent = 'COMPLETADO';
    
    const barraProgreso = document.getElementById('barraProgresoSecuencia');
    barraProgreso.className = 'progress-bar bg-success';
    
    console.log('🏁 Ejecución de secuencia finalizada');
}

function detenerEjecucionSecuencia() {
    if (ejecucionSecuencia.activa) {
        ejecucionSecuencia.timeoutPasos.forEach(timeout => clearTimeout(timeout));
        
        if (!ejecucionSecuencia.pausada) {
            agregarLogEjecucion('⏹️ SECUENCIA DETENIDA MANUALMENTE');
        }
    }
    
    ejecucionSecuencia = {
        activa: false,
        secuenciaId: null,
        pasos: [],
        pasoActual: 0,
        totalPasos: 0,
        timeoutPasos: [],
        inicioEjecucion: null,
        pausada: false,
        pasoInterrumpido: null,
        tiempoRestantePaso: 0
    };
}

function limpiarEjecucionSecuencia() {
    detenerEjecucionSecuencia();
    
    document.getElementById('barraProgresoSecuencia').style.width = '0%';
    document.getElementById('progresoTexto').textContent = '0%';
    document.getElementById('progresoDetalle').textContent = 'Preparando...';
    document.getElementById('logEjecucionSecuencia').innerHTML = 
        '<p class="text-secondary small text-center my-4"><i class="bi bi-info-circle me-2"></i>No hay secuencia en ejecución</p>';
    
    // Resetear controles
    actualizarUIEjecucionSecuencia();
    
    console.log('🧹 Monitor de secuencia limpiado');
}

// --- 10. Funciones de Debug ---

function debugSecuencia(data) {
    console.log('🐛 DEBUG - Estructura completa de la secuencia:', data);
    
    if (data.movimientos_programados) {
        console.log('📋 Movimientos programados:', data.movimientos_programados);
        data.movimientos_programados.forEach((paso, index) => {
            console.log(`   Paso ${index + 1}:`, paso);
            console.log(`   - Keys:`, Object.keys(paso));
            console.log(`   - Valores:`, Object.values(paso));
        });
    }
    
    return data;
}

function debugTiemposSecuencia(movimientos) {
    console.log('⏰ DEBUG - Tiempos de la secuencia:');
    
    movimientos.forEach((mov, index) => {
        const scheduled = new Date(mov.scheduled_at);
        console.log(`   Paso ${index + 1}: ${mov.operacion_texto}`);
        console.log(`   - Scheduled: ${scheduled.toLocaleTimeString()}.${scheduled.getMilliseconds()}`);
        
        if (index < movimientos.length - 1) {
            const nextScheduled = new Date(movimientos[index + 1].scheduled_at);
            const diferencia = nextScheduled - scheduled;
            console.log(`   - Duración calculada: ${diferencia}ms`);
        } else {
            console.log(`   - Último paso (duración por defecto: 1000ms)`);
        }
    });
}

// --- 11. Inicialización ---
// Agregar este evento en el DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
    const speedSelector = document.getElementById('speedSelector');
    const currentSpeed = document.getElementById('currentSpeed');
    
    if (speedSelector && currentSpeed) {
        speedSelector.addEventListener('change', function() {
            showAlert(`Velocidad configurada a ${this.value} para movimientos lineales`, 'info');
        });
    }
});

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Inicializando aplicación IoT Carrito con WebSockets nativos...');
    
    console.log('📍 Entorno: AWS EC2 Instance');
    console.log('🔗 API URL:', API_BASE_URL);
    console.log('🔗 WebSocket URL:', WS_BASE_URL);
    
    showAlert('🔗 Conectando a instancia AWS EC2 con WebSockets nativos...', 'info');

    // Inicializar estado
    const obstRes = document.getElementById('obstacleResult');
    if (obstRes) obstRes.classList.add('hidden');

    movementCache = [];
    obstacleCache = [];
    carritoEstado = {
        moviendose: false,
        movimientoActual: null,
        timeoutMovimiento: null
    };

    clearMonitoringDisplays();

    // Iniciar conexiones WebSocket
    console.log('🔄 Iniciando conexiones WebSocket nativas...');
    connectWebSocket(); // ← NUEVO
    
    // Cargar datos después de 3 segundos
    setTimeout(() => {
        loadMovementLogs();
        loadObstacleLogs();
    }, 3000);

    console.log('✅ Aplicación inicializada. WebSockets nativos iniciados.');
});

// Funciones de diagnóstico
function diagnoseWebSockets() {
    console.log('🔍 DIAGNÓSTICO WEBSOCKET ÚNICO:');
    console.log('📡 URL WebSocket:', `${WS_BASE_URL}/ws`);
    console.log('🔄 WebSocket Único:', webSocket ? `Conectado (${webSocket.readyState})` : 'No iniciado');
    console.log('📋 Dispositivo:', DEVICE_NAME);
    
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        console.log('✅ WebSocket único funcionando');
    }
}

function testWebSocketConnection() {
    console.log('🧪 TEST MANUAL DE WEBSOCKETS');
    console.log('1. URL WebSocket Base:', WS_BASE_URL);
    console.log('2. WebSocket Movimientos:', wsMovement ? `Estado: ${wsMovement.readyState}` : 'No existe');
    console.log('3. WebSocket Obstáculos:', wsObstacle ? `Estado: ${wsObstacle.readyState}` : 'No existe');
    console.log('4. Dispositivo:', DEVICE_NAME);
    
    if (wsMovement && wsMovement.readyState === WebSocket.OPEN) {
        console.log('✅ WebSocket de movimientos CONECTADO');
        showAlert('WebSocket de movimientos funcionando correctamente', 'success');
    } else {
        console.log('❌ WebSocket de movimientos NO CONECTADO - Reiniciando...');
        connectMovementWebSocket();
    }
    
    if (wsObstacle && wsObstacle.readyState === WebSocket.OPEN) {
        console.log('✅ WebSocket de obstáculos CONECTADO');
        showAlert('WebSocket de obstáculos funcionando correctamente', 'success');
    } else {
        console.log('❌ WebSocket de obstáculos NO CONECTADO - Reiniciando...');
        connectObstacleWebSocket();
    }
}

// Función para debug de estructura de datos WebSocket
function debugWebSocketData(eventData, type) {
    console.log(`🔍 DEBUG ${type} WebSocket Data Structure:`);
    console.log('Tipo:', typeof eventData);
    console.log('Keys:', Object.keys(eventData));
    console.log('Valores:', eventData);
    
    if (eventData.data) {
        console.log('📦 eventData.data existe. Keys:', Object.keys(eventData.data));
    }
    if (eventData.movement) {
        console.log('📦 eventData.movement existe. Keys:', Object.keys(eventData.movement));
    }
    if (eventData.obstacle) {
        console.log('📦 eventData.obstacle existe. Keys:', Object.keys(eventData.obstacle));
    }
}

// --- Funciones mejoradas para la UI de secuencias ---

function actualizarUIEjecucionSecuencia() {
    const estadoSecuencia = document.getElementById('estadoSecuencia');
    const infoPasoActual = document.getElementById('infoPasoActual');
    const btnReanudar = document.getElementById('btnReanudarSecuencia');
    const btnPausar = document.getElementById('btnPausarSecuencia');
    const btnDetener = document.getElementById('btnDetenerSecuencia');

    if (ejecucionSecuencia.activa) {
        estadoSecuencia.style.display = 'block';
        
        if (ejecucionSecuencia.pausada) {
            estadoSecuencia.style.backgroundColor = 'rgba(255, 193, 7, 0.2)';
            btnReanudar.disabled = false;
            btnPausar.disabled = true;
            btnDetener.disabled = false;
        } else {
            estadoSecuencia.style.backgroundColor = 'rgba(13, 110, 253, 0.2)';
            btnReanudar.disabled = true;
            btnPausar.disabled = false;
            btnDetener.disabled = false;
        }
        
        if (ejecucionSecuencia.pasoActual > 0 && ejecucionSecuencia.pasoActual <= ejecucionSecuencia.totalPasos) {
            infoPasoActual.classList.remove('hidden');
        }
    } else {
        estadoSecuencia.style.display = 'block';
        estadoSecuencia.style.backgroundColor = 'var(--bs-secondary)';
        infoPasoActual.classList.add('hidden');
        btnReanudar.disabled = true;
        btnPausar.disabled = true;
        btnDetener.disabled = true;
    }
}

function mostrarInformacionSecuencia() {
    const secuenciaIdActual = document.getElementById('secuenciaIdActual');
    const totalPasosSecuencia = document.getElementById('totalPasosSecuencia');
    
    if (secuenciaIdActual && totalPasosSecuencia) {
        secuenciaIdActual.textContent = ejecucionSecuencia.secuenciaId || '-';
        totalPasosSecuencia.textContent = ejecucionSecuencia.totalPasos || '-';
    }
    
    actualizarUIEjecucionSecuencia();
}

function mostrarPasoActual(numeroPaso, paso) {
    const pasoActualSecuencia = document.getElementById('pasoActualSecuencia');
    const operacionActual = document.getElementById('operacionActual');
    const duracionActual = document.getElementById('duracionActual');
    
    if (pasoActualSecuencia) {
        pasoActualSecuencia.textContent = `${numeroPaso}/${ejecucionSecuencia.totalPasos}`;
    }
    
    if (operacionActual && duracionActual) {
        let operacionTexto = paso.operacion_texto;
        if (!operacionTexto && paso.operacion && OPERACION_MAP) {
            operacionTexto = Object.keys(OPERACION_MAP).find(key => OPERACION_MAP[key] === paso.operacion);
        }
        if (!operacionTexto) {
            operacionTexto = `Operación ${paso.operacion || 'N/A'}`;
        }
        
        operacionActual.textContent = operacionTexto;
        duracionActual.textContent = `${Math.round(paso.duracion_ms)}ms`;
    }
}

function actualizarProgreso(pasoActual, tiempoRestante) {
    const barraProgreso = document.getElementById('barraProgresoSecuencia');
    const progresoTexto = document.getElementById('progresoTexto');
    const progresoDetalle = document.getElementById('progresoDetalle');
    const tiempoRestanteSecuencia = document.getElementById('tiempoRestanteSecuencia');
    
    if (!barraProgreso || !progresoTexto || !progresoDetalle || !tiempoRestanteSecuencia) {
        console.error('❌ Elementos de progreso no encontrados');
        return;
    }
    
    const progreso = (pasoActual / ejecucionSecuencia.totalPasos) * 100;
    barraProgreso.style.width = `${progreso}%`;
    progresoTexto.textContent = `${Math.round(progreso)}%`;
    tiempoRestanteSecuencia.textContent = tiempoRestante;
    
    // Actualizar detalles del progreso
    progresoDetalle.textContent = `Paso ${pasoActual} de ${ejecucionSecuencia.totalPasos} • ${tiempoRestante}`;
    
    // Cambiar color de la barra según el progreso
    if (progreso < 50) {
        barraProgreso.style.backgroundColor = '#0d6efd'; // Azul
    } else if (progreso < 100) {
        barraProgreso.style.backgroundColor = '#198754'; // Verde
    } else {
        barraProgreso.style.backgroundColor = '#198754'; // Verde completo
    }
    
    console.log(`📈 Progreso actualizado: ${Math.round(progreso)}% - Tiempo restante: ${tiempoRestante}`);
}

function agregarLogEjecucion(mensaje) {
    const logEjecucion = document.getElementById('logEjecucionSecuencia');
    const ahora = new Date();
    const timestamp = ahora.toLocaleTimeString() + '.' + ahora.getMilliseconds().toString().padStart(3, '0');
    
    // Si es el primer mensaje, limpiar el placeholder
    if (logEjecucion.innerHTML.includes('No hay secuencia en ejecución')) {
        logEjecucion.innerHTML = '';
    }
    
    const logEntry = document.createElement('div');
    logEntry.className = 'border-bottom border-secondary py-2 small';
    
    // Determinar el icono y color según el tipo de mensaje
    let icono = 'bi-info-circle';
    let color = 'text-light';
    
    if (mensaje.includes('✅') || mensaje.includes('COMPLETADO')) {
        icono = 'bi-check-circle-fill';
        color = 'text-success';
    } else if (mensaje.includes('▶️') || mensaje.includes('INICIADA')) {
        icono = 'bi-play-circle-fill';
        color = 'text-primary';
    } else if (mensaje.includes('❌') || mensaje.includes('ERROR')) {
        icono = 'bi-exclamation-circle-fill';
        color = 'text-danger';
    } else if (mensaje.includes('⏸️') || mensaje.includes('PAUSADA')) {
        icono = 'bi-pause-circle-fill';
        color = 'text-warning';
    } else if (mensaje.includes('🚫') || mensaje.includes('INTERRUMPIDA')) {
        icono = 'bi-slash-circle-fill';
        color = 'text-danger';
    } else if (mensaje.includes('🔄') || mensaje.includes('REANUDANDO')) {
        icono = 'bi-arrow-repeat';
        color = 'text-info';
    }
    
    logEntry.innerHTML = `
        <div class="d-flex align-items-start">
            <i class="bi ${icono} ${color} me-2 mt-1"></i>
            <div class="flex-grow-1">
                <span class="text-light">[${timestamp}]</span> 
                <span class="${color}">${mensaje}</span>
            </div>
        </div>
    `;
    
    logEjecucion.prepend(logEntry);
    
    // Limitar a 20 entradas máximo
    const entries = logEjecucion.querySelectorAll('div');
    if (entries.length > 20) {
        entries[entries.length - 1].remove();
    }
    
    // Efecto visual de nueva entrada
    logEntry.style.animation = 'fadeIn 0.5s ease-in';
}

// Funciones de control de secuencia
function pausarSecuencia() {
    if (!ejecucionSecuencia.activa || ejecucionSecuencia.pausada) return;
    
    ejecucionSecuencia.pausada = true;
    ejecucionSecuencia.timeoutPasos.forEach(timeout => clearTimeout(timeout));
    ejecucionSecuencia.timeoutPasos = [];
    
    agregarLogEjecucion('⏸️ SECUENCIA PAUSADA');
    showAlert('Secuencia pausada', 'warning');
    actualizarUIEjecucionSecuencia();
}

function reanudarSecuencia() {
    if (!ejecucionSecuencia.activa || !ejecucionSecuencia.pausada) return;
    
    ejecucionSecuencia.pausada = false;
    ejecucionSecuencia.inicioEjecucion = new Date();
    
    agregarLogEjecucion('🔄 SECUENCIA REANUDADA');
    showAlert('Secuencia reanudada', 'success');
    actualizarUIEjecucionSecuencia();
    
    // Continuar con el siguiente paso
    ejecutarSiguientePaso();
}

function detenerSecuencia() {
    if (!ejecucionSecuencia.activa) return;
    
    ejecucionSecuencia.timeoutPasos.forEach(timeout => clearTimeout(timeout));
    ejecucionSecuencia.timeoutPasos = [];
    
    agregarLogEjecucion('⏹️ SECUENCIA DETENIDA MANUALMENTE');
    showAlert('Secuencia detenida', 'info');
    
    ejecucionSecuencia.activa = false;
    ejecucionSecuencia.pausada = false;
    
    // Enviar comando de detener al carrito
    sendMovement(3);
    
    actualizarUIEjecucionSecuencia();
    limpiarEjecucionSecuencia();
}

function verificarElementosDemo() {
    const elementos = [
        'nPasos', 'minMs', 'maxMs', 'excluirDetener'
    ];
    
    let todosExisten = true;
    
    elementos.forEach(id => {
        const elemento = document.getElementById(id);
        console.log(`Elemento ${id}:`, elemento ? 'ENCONTRADO' : 'NO ENCONTRADO');
        if (!elemento) {
            todosExisten = false;
        }
    });
    
    return todosExisten;
}

async function cancelarSecuencia() {
    try {
        const response = await fetch(`${API_BASE_URL}/demo/${DEVICE_NAME}/cancel`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al cancelar secuencia');
        }

        const result = await response.json();
        console.log('✅ Secuencia cancelada:', result);
        showAlert('Secuencia cancelada exitosamente', 'success');
        
        // Limpiar estado local de ejecución
        detenerEjecucionSecuencia();
        
        return result;

    } catch (error) {
        console.error('❌ Error cancelando secuencia:', error);
        showAlert(`Error al cancelar secuencia: ${error.message}`, 'danger');
        return null;
    }
}

// Modificar la función detenerSecuencia para usar la API de cancel
function detenerSecuencia() {
    if (!ejecucionSecuencia.activa) return;
    
    // Llamar a la API de cancel
    cancelarSecuencia().then(() => {
        // Limpiar estado local aunque falle la API
        ejecucionSecuencia.timeoutPasos.forEach(timeout => clearTimeout(timeout));
        ejecucionSecuencia.timeoutPasos = [];
        
        agregarLogEjecucion('⏹️ SECUENCIA DETENIDA MANUALMENTE');
        showAlert('Secuencia detenida', 'info');
        
        ejecucionSecuencia.activa = false;
        ejecucionSecuencia.pausada = false;
        
        // Enviar comando de detener al carrito
        sendMovement(3);
        
        actualizarUIEjecucionSecuencia();
        limpiarEjecucionSecuencia();
    });
}

// Llama a esta función en la consola del navegador para debuggear
window.verificarElementosDemo = verificarElementosDemo;
// Llamar esta función en los message handlers temporalmente para debug
// En wsMovement.onmessage, después de JSON.parse:
// debugWebSocketData(data, 'MOVEMENT');

// En wsObstacle.onmessage, después de JSON.parse:  
// debugWebSocketData(data, 'OBSTACLE');

// Hacer disponibles para pruebas
window.diagnoseWS = diagnoseWebSockets;
window.testWS = testWebSocketConnection;
window.connectWS = connectWebSockets;