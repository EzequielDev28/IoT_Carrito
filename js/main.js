// --- 1. Configuración Global ACTUALIZADA ---
// DETECTAR SI ESTAMOS EN GITHUB PAGES O DESARROLLO LOCAL
const isGitHubPages = window.location.hostname.includes('github.io');

// URLs según el entorno - REEMPLAZA 100.26.151.211 CON TU IP DE AWS
const API_BASE_URL = isGitHubPages 
    ? 'https://100.26.151.211:5500/api'  // HTTPS para GitHub Pages
    : 'http://127.0.0.1:5500/api';  // HTTP para desarrollo local

const WS_BASE_URL = isGitHubPages 
    ? 'https://100.26.151.211:5500'      // WSS para GitHub Pages  
    : 'http://127.0.0.1:5500';      // WS para desarrollo local

console.log(`🌐 Entorno: ${isGitHubPages ? 'GitHub Pages (HTTPS)' : 'Desarrollo Local (HTTP)'}`);
console.log(`🔗 API: ${API_BASE_URL}`);
console.log(`🔗 WebSocket: ${WS_BASE_URL}`);

let DEVICE_NAME = document.getElementById('deviceInput').value || 'carrito-alpha';

// Control de estado del carrito
let carritoEstado = {
    moviendose: false,
    movimientoActual: null,
    timeoutMovimiento: null,
    duracionMovimiento: 2000 // 1 segundo para Adelante y Atrás
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
    pausada: false,                    // NUEVO: Para pausar por obstáculo
    pasoInterrumpido: null,            // NUEVO: Guardar paso interrumpido
    tiempoRestantePaso: 0              // NUEVO: Tiempo restante del paso interrumpido
};

// --- Datos de Ubicación y Hora en Tiempo Real ---
let ubicacionReal = {
    ip: 'Desconocida',
    pais: 'Desconocido',
    ciudad: 'Desconocida',
    lat: null,
    lon: null,
    timestamp: null
};

// Función para obtener la IP pública
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

// Función para obtener ubicación geográfica
async function obtenerUbicacion() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocalización no soportada'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    accuracy: position.coords.accuracy
                });
            },
            (error) => {
                console.warn('Error obteniendo ubicación:', error);
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000
            }
        );
    });
}

// Función principal para inicializar datos de ubicación
async function inicializarUbicacionReal() {
    try {
        // Obtener IP pública
        ubicacionReal.ip = await obtenerIP();
        
        // Obtener geolocalización por IP
        const geoData = await obtenerGeolocalizacionPorIP(ubicacionReal.ip);
        ubicacionReal.pais = geoData.pais;
        ubicacionReal.ciudad = geoData.ciudad;
        
        // Intentar obtener ubicación GPS precisa
        try {
            const gpsData = await obtenerUbicacion();
            ubicacionReal.lat = gpsData.lat;
            ubicacionReal.lon = gpsData.lon;
        } catch (gpsError) {
            // Fallback a datos de IP para coordenadas
            if (geoData.lat_ip && geoData.lon_ip) {
                ubicacionReal.lat = geoData.lat_ip;
                ubicacionReal.lon = geoData.lon_ip;
                console.log('Usando coordenadas aproximadas por IP');
            }
        }
        
// Actualizar timestamp en hora local
ubicacionReal.timestamp = obtenerTimestampActual();        
        console.log('📍 Ubicación real obtenida:', ubicacionReal);
        return ubicacionReal;
    } catch (error) {
        console.error('Error inicializando ubicación:', error);
        // Datos por defecto mínimos
        ubicacionReal.timestamp = new Date().toISOString();
        return ubicacionReal;
    }
}

function verificarHora() {
    const ahora = new Date();
    console.log('🕐 Hora actual:');
    console.log(' - Local:', ahora.toString());
    console.log(' - ISO:', ahora.toISOString());
    console.log(' - Nuestra función:', obtenerTimestampActual());
}

// Llamar para verificar
verificarHora();

// Función para obtener timestamp actual en hora local (formato legible)
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

// Función para obtener datos completos para enviar al servidor
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

// --- 2. Inicialización de WebSockets MEJORADA ---
let socket;
let isMonitoringActive = false;

// Caches locales
let movementCache = [];
let obstacleCache = [];

function connectWebSocket() {
    if (socket && socket.connected) {
        socket.off();
        socket.disconnect();
    }

    // CONFIGURACIÓN MEJORADA PARA SSL
    const socketOptions = {
        transports: ['websocket', 'polling'],
        timeout: 5000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    };

    // AGREGAR CONFIGURACIÓN SSL SOLO PARA GITHUB PAGES
    if (isGitHubPages) {
        socketOptions.secure = true;
        socketOptions.rejectUnauthorized = false; // Para certificados auto-firmados
        console.log('🔒 Conectando con WebSocket seguro (WSS)');
    } else {
        console.log('🔓 Conectando con WebSocket normal (WS)');
    }

    socket = io(WS_BASE_URL, socketOptions);

    const wsStatus = document.getElementById('wsStatus');

    socket.on('connect', () => {
        console.log('✅ WebSocket conectado:', socket.id);
        wsStatus.textContent = 'Conectado';
        wsStatus.className = 'fw-bold text-success';
        
        logToWS(`Conectado al dispositivo: ${DEVICE_NAME}`);
        
        // Suscribirse al monitoreo automático
        subscribeToMonitoring();
        
        // Cargar datos iniciales via WebSocket
        requestImmediateData();
    });

    socket.on('disconnect', (reason) => {
        console.log('❌ WebSocket desconectado:', reason);
        wsStatus.textContent = 'Desconectado';
        wsStatus.className = 'fw-bold text-danger';
        logToWS(`Desconectado: ${reason}`);
        isMonitoringActive = false;
    });

    socket.on('connect_error', (error) => {
        console.log('❌ Error de conexión WebSocket:', error);
        wsStatus.textContent = 'Error de conexión';
        wsStatus.className = 'fw-bold text-warning';
        logToWS(`Error de conexión: ${error.message}`);
        
        // Mostrar ayuda específica para SSL
        if (isGitHubPages && error.message.includes('SSL')) {
            showAlert('Error SSL: Verifica que el servidor tenga certificados válidos', 'danger');
        }
    });

    socket.on('connection_status', (data) => {
        console.log('📊 Estado de conexión:', data);
        if (data.ssl_enabled) {
            logToWS('✅ Conexión segura SSL establecida');
        }
    });

    // ... (el resto de tus event listeners permanecen igual)
    socket.on('demo_scheduled_' + DEVICE_NAME, (data) => {
        console.log('🎭 Demo programada:', data);
        logToWS(`Demo programada con ${data.movimientos_programados?.length || 0} movimientos`);
        
        if (data.movimientos_programados && data.movimientos_programados.length > 0) {
            const secuenciaId = data.ejecucion?.secuencia_id || data.ejecucion?.id;
            if (secuenciaId) {
                setTimeout(() => {
                    iniciarMonitoreoSecuencia(secuenciaId, data.movimientos_programados);
                }, 1000);
            }
        }
    });

    // Mantén todos tus otros event listeners aquí...
    socket.on('movement_created', (data) => {
        console.log('🆕 Nuevo movimiento creado:', data);
    });

    socket.on('movement_update', (data) => {
        console.log('📡 Movimiento actualizado via WS:', data);
        handleMovementEvent(data.data || data);
    });

    socket.on('obstacle_update', (data) => {
        console.log('📡 Obstáculo actualizado via WS:', data);
        handleObstacleEvent(data.data || data);
    });

    socket.on('immediate_movement_response', (data) => {
        console.log('🎯 Movimiento inmediato recibido:', data);
        handleMovementEvent(data.data || data);
    });

    socket.on('immediate_obstacle_response', (data) => {
        console.log('🎯 Obstáculo inmediato recibido:', data);
        handleObstacleEvent(data.data || data);
    });

    socket.on('subscription_confirmed', (data) => {
        console.log('✅ Suscripción confirmada:', data);
        logToWS(`Suscripción activa: ${data.type} para ${data.device_name}`);
        isMonitoringActive = true;
    });

    socket.on('error', (error) => {
        console.error('❌ Error via WebSocket:', error);
        showAlert(`Error: ${error.message || 'Error en comunicación'}`, 'danger');
        logToWS(`Error: ${error.message || 'Error desconocido'}`);
    });
}


function iniciarMonitoreoSecuencia(secuenciaId, movimientosProgramados) {
    if (!movimientosProgramados || movimientosProgramados.length === 0) {
        console.log('❌ No hay movimientos programados para monitorear');
        return;
    }

    // Limpiar ejecución anterior si existe
    detenerEjecucionSecuencia();

    // Calcular duraciones basadas en scheduled_at
    const pasosConDuracion = calcularDuraciones(movimientosProgramados);
    
    console.log('📋 Pasos con duración calculada:', pasosConDuracion);

    ejecucionSecuencia = {
        activa: true,
        secuenciaId: secuenciaId,
        pasos: pasosConDuracion,
        pasoActual: 0,
        totalPasos: pasosConDuracion.length,
        timeoutPasos: [],
        inicioEjecucion: new Date()
    };

    // Mostrar información de la secuencia
    mostrarInformacionSecuencia();
    
    // Iniciar el primer paso
    ejecutarSiguientePaso();
    
    console.log(`🎬 Iniciando monitoreo de secuencia ID: ${secuenciaId} con ${pasosConDuracion.length} pasos`);
    agregarLogEjecucion(`🎬 SECUENCIA INICIADA - ID: ${secuenciaId} | Pasos: ${pasosConDuracion.length}`);
}

// --- AGREGAR función para calcular duraciones ---
function calcularDuraciones(movimientos) {
    if (!movimientos || movimientos.length === 0) return [];
    
    const pasos = [];
    
    for (let i = 0; i < movimientos.length; i++) {
        const movimiento = movimientos[i];
        const scheduledAt = new Date(movimiento.scheduled_at);
        
        // Calcular duración basada en la diferencia con el siguiente movimiento
        let duracion_ms = 1000; // Duración por defecto
        
        if (i < movimientos.length - 1) {
            const nextScheduledAt = new Date(movimientos[i + 1].scheduled_at);
            duracion_ms = nextScheduledAt - scheduledAt;
            
            // Asegurar duración mínima de 100ms
            if (duracion_ms < 100) {
                duracion_ms = 1000; // Fallback a 1 segundo
            }
        } else {
            // Último movimiento - usar duración por defecto
            duracion_ms = 1000;
        }
        
        pasos.push({
            operacion: movimiento.operacion_clave,
            duracion_ms: duracion_ms,
            scheduled_at: movimiento.scheduled_at,
            operacion_texto: movimiento.operacion_texto,
            movimiento_original: movimiento
        });
    }
    
    return pasos;
}

// --- AGREGAR función de debug para secuencias ---
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

function ejecutarSiguientePaso() {
    // Verificar si la secuencia está pausada por obstáculo
    if (ejecucionSecuencia.pausada) {
        console.log('⏸️ Secuencia pausada, esperando reanudación...');
        return;
    }
    
    if (!ejecucionSecuencia.activa || ejecucionSecuencia.pasoActual >= ejecucionSecuencia.totalPasos) {
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
        ejecutarSiguientePaso();
        return;
    }
    
    // Mostrar el paso actual
    mostrarPasoActual(numeroPaso, paso);
    
    // Calcular tiempo restante total
    const tiempoRestante = calcularTiempoRestanteTotal();
    
    // Actualizar progreso
    actualizarProgreso(numeroPaso, tiempoRestante);
    
    // Log del paso ejecutado
    const operacionTexto = paso.operacion_texto || Object.keys(OPERACION_MAP).find(key => OPERACION_MAP[key] === paso.operacion) || `Operación ${paso.operacion}`;
    agregarLogEjecucion(`▶️ Paso ${numeroPaso}/${ejecucionSecuencia.totalPasos}: ${operacionTexto} (${Math.round(paso.duracion_ms)}ms)`);
    
    console.log(`⏱️ Programando paso ${numeroPaso} por ${paso.duracion_ms}ms - ${operacionTexto}`);
    
    // Programar el siguiente paso
    const timeout = setTimeout(() => {
        // Verificar nuevamente si no está pausada antes de continuar
        if (!ejecucionSecuencia.pausada) {
            console.log(`✅ Paso ${numeroPaso} completado`);
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
    
    secuenciaInfo.classList.remove('hidden');
    secuenciaIdActual.textContent = ejecucionSecuencia.secuenciaId;
    totalPasosSecuencia.textContent = ejecucionSecuencia.totalPasos;
}

function mostrarPasoActual(numeroPaso, paso) {
    const pasoActualSecuencia = document.getElementById('pasoActualSecuencia');
    
    // Usar operacion_texto si está disponible, sino usar el mapa
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
    const progreso = (pasoActual / ejecucionSecuencia.totalPasos) * 100;
    const barraProgreso = document.getElementById('barraProgresoSecuencia');
    const progresoTexto = document.getElementById('progresoTexto');
    const tiempoRestanteSecuencia = document.getElementById('tiempoRestanteSecuencia');
    
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
}

// --- AGREGAR función para debug de tiempos ---
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

function calcularTiempoRestanteTotal() {
    if (!ejecucionSecuencia.activa) return '0s';
    
    let tiempoTotalRestante = 0;
    for (let i = ejecucionSecuencia.pasoActual; i < ejecucionSecuencia.totalPasos; i++) {
        tiempoTotalRestante += ejecucionSecuencia.pasos[i].duracion_ms;
    }
    
    // Si el tiempo es muy pequeño, mostrar 0s
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
    
    // Mantener máximo 15 entradas en el log
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
    
    // Actualizar UI final
    actualizarProgreso(ejecucionSecuencia.totalPasos, '0s');
    document.getElementById('pasoActualSecuencia').textContent = 'COMPLETADO';
    
    // Cambiar barra a éxito completo
    const barraProgreso = document.getElementById('barraProgresoSecuencia');
    barraProgreso.className = 'progress-bar bg-success';
    
    console.log('🏁 Ejecución de secuencia finalizada');
}

function detenerEjecucionSecuencia() {
    if (ejecucionSecuencia.activa) {
        // Limpiar todos los timeouts
        ejecucionSecuencia.timeoutPasos.forEach(timeout => clearTimeout(timeout));
        
        // Solo loggear si no fue por obstáculo
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
    
    // Resetear UI
    document.getElementById('secuenciaInfo').classList.add('hidden');
    document.getElementById('barraProgresoSecuencia').style.width = '0%';
    document.getElementById('barraProgresoSecuencia').className = 'progress-bar progress-bar-striped progress-bar-animated';
    document.getElementById('progresoTexto').textContent = '0%';
    document.getElementById('logEjecucionSecuencia').innerHTML = 
        '<p class="text-secondary small text-center mt-3">No hay secuencia en ejecución</p>';
    
    console.log('🧹 Monitor de secuencia limpiado');
}

// --- AGREGAR función para cancelar evasión (opcional) ---
function cancelarEvasionYContinuar() {
    if (ejecucionSecuencia.activa && ejecucionSecuencia.pausada) {
        console.log('⏩ Cancelando evasión y continuando secuencia');
        agregarLogEjecucion('⏩ Evasión cancelada - Continuando secuencia');
        
        // Reanudar sin procesar evasión
        ejecucionSecuencia.pausada = false;
        ejecucionSecuencia.pasoInterrumpido = null;
        ejecucionSecuencia.tiempoRestantePaso = 0;
        
        ejecutarSiguientePaso();
        showAlert('Evasión cancelada, continuando secuencia', 'info');
    }
}

function subscribeToMonitoring() {
    if (socket && socket.connected) {
        // Suscribirse a monitoreo automático cada 0.5 segundos
        socket.emit('subscribe_movements', { device_name: DEVICE_NAME });
        socket.emit('subscribe_obstacles', { device_name: DEVICE_NAME });
        console.log('📡 Suscripciones enviadas para monitoreo automático');
    }
}

function requestImmediateData() {
    if (socket && socket.connected) {
        // Solicitar datos inmediatos al conectar
        socket.emit('get_immediate_movement', { device_name: DEVICE_NAME });
        socket.emit('get_immediate_obstacle', { device_name: DEVICE_NAME });
        console.log('🎯 Solicitados datos inmediatos via WebSocket');
    }
}

function logToWS(message) {
    const wsLog = document.getElementById('wsLog');
    const now = new Date().toLocaleTimeString();
    const logEntry = `<p class="small mb-1">[${now}] ${message}</p>`;
    
    // Mantener solo los últimos 10 mensajes
    const currentLogs = wsLog.innerHTML;
    const logsArray = currentLogs.split('</p>').filter(log => log.trim() !== '');
    logsArray.unshift(logEntry);
    
    if (logsArray.length > 10) {
        logsArray.length = 10;
    }
    
    wsLog.innerHTML = logsArray.join('</p>') + '</p>';
}

// Función para cambiar el dispositivo
function updateDeviceName(newName) {
    if (newName && newName !== DEVICE_NAME) {
        const oldName = DEVICE_NAME;
        DEVICE_NAME = newName;
        
        showAlert(`Cambiando dispositivo de ${oldName} a ${DEVICE_NAME}. Reconectando WS...`, 'info');
        
        // Limpiar caches
        movementCache = [];
        obstacleCache = [];
        
        // Actualizar UI
        clearMonitoringDisplays();
        
        // Reconectar WebSocket
        if (socket) {
            socket.emit('unsubscribe_movements', { device_name: oldName });
            socket.emit('unsubscribe_obstacles', { device_name: oldName });
        }
        
        connectWebSocket();
    }
}

function clearMonitoringDisplays() {
    document.getElementById('lastMovement').innerHTML = '<p class="text-secondary">Cargando...</p>';
    document.getElementById('last10Movements').innerHTML = '<p class="text-secondary">Cargando...</p>';
    document.getElementById('lastObstacle').innerHTML = '<p class="text-secondary">Cargando...</p>';
    document.getElementById('last10Obstacles').innerHTML = '<p class="text-secondary">Cargando...</p>';
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
    
    // Auto-destruir después de 5 segundos
    setTimeout(() => {
        if (alertDiv.parentNode) {
            const bsAlert = bootstrap.Alert.getOrCreateInstance(alertDiv);
            bsAlert.close();
        }
    }, 5000);
}

function changeTab(tabId) {
    if (tabId === 'monitor') {
        // Si no hay datos en cache, cargar via REST
        if (movementCache.length === 0) {
            loadMovementLogs();
        }
        if (obstacleCache.length === 0) {
            loadObstacleLogs();
        }
        
        // También solicitar datos inmediatos via WebSocket
        requestImmediateData();
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
        
        // Texto principal
        const operation = item.operacion_texto || item.sugerencia_texto || item.obstaculo_texto || item.operacion || 'N/A';
        const type = item.operacion_texto || item.operacion ? 'MOVIMIENTO' : 'OBSTÁCULO';
        const icon = item.operacion_texto || item.operacion ? 'bi-arrow-right-circle' : 'bi-cone-striped';
        const textColor = item.operacion_texto || item.operacion ? 'text-info' : 'text-warning';
        
        // Detalles de tiempo
        const timeDetail = item.event_at ? 
            `Hace ${getTimeAgo(new Date(item.event_at))} (${new Date(item.event_at).toLocaleTimeString()})` : 
            item.scheduled_at ? 
            `Programado: ${new Date(item.scheduled_at).toLocaleString()}` : 
            'Sin timestamp';

        // Detalles de ubicación
        const locationDetail = (item.ciudad && item.pais) ? 
            `${item.ciudad}, ${item.pais}` : 
            (item.ip ? `IP: ${item.ip}` : '');

        html += `<div class="py-2 border-bottom border-secondary">
            <p class="small fw-bold ${textColor} mb-1">
                <i class="bi ${icon} me-1"></i> [${type}] ${operation}
            </p>
            <p class="small text-secondary mb-0 ps-3">
                <i class="bi bi-clock me-1"></i>${timeDetail}
                ${item.lat && item.lon ? `<br><i class="bi bi-pin-map me-1"></i>${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}` : ''}
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

async function postData(endpoint, data) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(data),
            mode: 'cors',  // Agregar explícitamente
            credentials: 'omit'  // No enviar cookies
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
            },
            mode: 'cors',
            credentials: 'omit'
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

// --- 4. Controladores de Eventos de la Interfaz ---


function sendMovement(op_clave) {
    const op_name = Object.keys(OPERACION_MAP).find(key => OPERACION_MAP[key] === op_clave);
    
    // Si hay un movimiento en curso y se envía uno nuevo, cancelar el anterior
    if (carritoEstado.moviendose && carritoEstado.timeoutMovimiento) {
        clearTimeout(carritoEstado.timeoutMovimiento);
        carritoEstado.moviendose = false;
        console.log('🔄 Movimiento anterior cancelado');
    }
    
    // Obtener datos de ubicación actualizados
    const datosUbicacion = obtenerDatosUbicacion();
    
    const data = {
        device_name: DEVICE_NAME,
        operacion: op_clave,
        ip: datosUbicacion.ip,
        pais: datosUbicacion.pais,
        ciudad: datosUbicacion.ciudad,
        latitud: datosUbicacion.latitud,
        longitud: datosUbicacion.longitud,
        event_at: datosUbicacion.timestamp  // Usar timestamp actual
    };
    
    postData('/movement/', data).then(result => {
        if (result) {
            // Para movimientos de Adelante (1) y Atrás (2), establecer duración de 1 segundo
            if (op_clave === 1 || op_clave === 2) {
                carritoEstado.moviendose = true;
                carritoEstado.movimientoActual = op_clave;
                
                console.log(`▶️ Iniciando movimiento ${op_name} por ${carritoEstado.duracionMovimiento}ms`);
                
                // Establecer timeout para auto-detener después de 1 segundo
                carritoEstado.timeoutMovimiento = setTimeout(() => {
                    if (carritoEstado.moviendose) {
                        console.log('⏱️ Movimiento auto-deternido después de 1 segundo');
                        sendMovement(3); // Auto-detener después de 1 segundo
                        carritoEstado.moviendose = false;
                        carritoEstado.movimientoActual = null;
                        showAlert('Movimiento completado (1 segundo)', 'info');
                    }
                }, carritoEstado.duracionMovimiento);
                
            } else if (op_clave === 3) {
                // Si es detener, limpiar estado
                carritoEstado.moviendose = false;
                carritoEstado.movimientoActual = null;
                if (carritoEstado.timeoutMovimiento) {
                    clearTimeout(carritoEstado.timeoutMovimiento);
                }
                console.log('🛑 Movimiento detenido manualmente');
            } else {
                // Para otros movimientos (giros, vueltas), no aplicar duración fija
                console.log(`↪️ Movimiento especial: ${op_name}`);
            }
        }
    });
}

function sendObstacle(obst_clave) {
    const obst_name = Object.keys(OBSTACULO_MAP).find(key => OBSTACULO_MAP[key] === obst_clave);
    
    // Obtener datos de ubicación actualizados
    const datosUbicacion = obtenerDatosUbicacion();
    
    const data = {
        device_name: DEVICE_NAME,
        obstaculo: obst_clave,
        ip: datosUbicacion.ip,
        pais: datosUbicacion.pais,
        ciudad: datosUbicacion.ciudad,
        latitud: datosUbicacion.latitud,
        longitud: datosUbicacion.longitud,
        event_at: datosUbicacion.timestamp  // Usar timestamp actual
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
            
            // Si hay una secuencia en ejecución, interrumpirla y procesar el obstáculo
            if (ejecucionSecuencia.activa && !ejecucionSecuencia.pausada) {
                interrumpirSecuenciaPorObstaculo(result);
            } 
            // Si hay un movimiento manual en curso, detenerlo
            else if (carritoEstado.moviendose) {
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
        
        // Cancelar el timeout de auto-detener
        if (carritoEstado.timeoutMovimiento) {
            clearTimeout(carritoEstado.timeoutMovimiento);
        }
        
        // Enviar comando de detener
        sendMovement(3);
        
        // Mostrar alerta específica
        showAlert('¡Obstáculo detectado! Movimiento detenido automáticamente', 'warning');
        
        // Actualizar estado inmediatamente
        carritoEstado.moviendose = false;
        carritoEstado.movimientoActual = null;
    }
}

// --- AGREGAR función para interrumpir secuencia por obstáculo ---
function interrumpirSecuenciaPorObstaculo(obstaculoData) {
    if (!ejecucionSecuencia.activa || ejecucionSecuencia.pausada) return;
    
    console.log('🚫 OBSTÁCULO - Interrumpiendo secuencia en curso');
    
    // Pausar la secuencia actual
    ejecucionSecuencia.pausada = true;
    
    // Guardar información del paso actual
    const pasoActual = ejecucionSecuencia.pasos[ejecucionSecuencia.pasoActual];
    ejecucionSecuencia.pasoInterrumpido = ejecucionSecuencia.pasoActual;
    
    // Calcular tiempo restante del paso actual (aproximado)
    const tiempoTranscurrido = new Date() - ejecucionSecuencia.inicioEjecucion;
    const tiempoTotalPasos = ejecucionSecuencia.pasos.slice(0, ejecucionSecuencia.pasoActual)
        .reduce((sum, paso) => sum + paso.duracion_ms, 0);
    const tiempoTranscurridoPaso = tiempoTranscurrido - tiempoTotalPasos;
    ejecucionSecuencia.tiempoRestantePaso = Math.max(0, pasoActual.duracion_ms - tiempoTranscurridoPaso);
    
    // Detener todos los timeouts de la secuencia
    ejecucionSecuencia.timeoutPasos.forEach(timeout => clearTimeout(timeout));
    ejecucionSecuencia.timeoutPasos = [];
    
    // Enviar comando de detener inmediatamente
    sendMovement(3);
    
    // Log de interrupción
    agregarLogEjecucion(`🚫 SECUENCIA INTERRUMPIDA - Obstáculo detectado: ${obstaculoData.obstaculo_texto}`);
    agregarLogEjecucion(`💡 Sugerencia: ${obstaculoData.sugerencia_texto}`);
    
    showAlert('¡Obstáculo detectado! Secuencia interrumpida para evasión', 'warning');
    
    // Procesar la evasión basada en la sugerencia
    procesarEvasionObstaculo(obstaculoData);
}

// --- AGREGAR función para procesar evasión de obstáculo ---
function procesarEvasionObstaculo(obstaculoData) {
    const sugerencia = obstaculoData.sugerencia_texto;
    
    console.log(`🔄 Procesando evasión: ${sugerencia}`);
    agregarLogEjecucion(`🔄 Ejecutando evasión: ${sugerencia}`);
    
    // Mapear sugerencias a movimientos específicos
    const evasionMap = {
        'Detener': 3,
        'Retroceder': 2,
        'Girar a la izquierda': 9,
        'Girar a la derecha': 8,
        'Avanzar con precaución': 1
    };
    
    let movimientoEvasion = 3; // Por defecto: detener
    
    // Buscar la sugerencia en el mapa
    for (const [key, value] of Object.entries(evasionMap)) {
        if (sugerencia.includes(key)) {
            movimientoEvasion = value;
            break;
        }
    }
    
    // Ejecutar movimiento de evasión
    console.log(`↪️ Ejecutando movimiento de evasión: ${movimientoEvasion}`);
    
    // Pequeño delay antes de la evasión para asegurar que se detuvo
    setTimeout(() => {
        sendMovement(movimientoEvasion);
        
        // Programar reanudación después de la evasión
        setTimeout(() => {
            reanudarSecuenciaDespuesObstaculo();
        }, 2000); // 2 segundos para la evasión
        
    }, 500);
}

// --- AGREGAR función para reanudar secuencia después de obstáculo ---
function reanudarSecuenciaDespuesObstaculo() {
    if (!ejecucionSecuencia.activa || !ejecucionSecuencia.pausada) return;
    
    console.log('🔄 REANUDANDO secuencia después de evasión de obstáculo');
    agregarLogEjecucion('🔄 REANUDANDO secuencia después de evasión');
    
    // Reestablecer estado de la secuencia
    ejecucionSecuencia.pausada = false;
    ejecucionSecuencia.inicioEjecucion = new Date(); // Reiniciar tiempo de referencia
    
    // Continuar con el siguiente paso (no repetir el interrumpido para evitar duplicados)
    // El movimiento de evasión ya debería haber completado la acción necesaria
    ejecucionSecuencia.pasoActual = ejecucionSecuencia.pasoInterrumpido + 1;
    
    // Limpiar información de interrupción
    ejecucionSecuencia.pasoInterrumpido = null;
    ejecucionSecuencia.tiempoRestantePaso = 0;
    
    // Continuar con la ejecución normal
    if (ejecucionSecuencia.pasoActual < ejecucionSecuencia.totalPasos) {
        agregarLogEjecucion(`▶️ Reanudando desde paso ${ejecucionSecuencia.pasoActual + 1}`);
        ejecutarSiguientePaso();
    } else {
        // Si ya no hay más pasos, finalizar
        finalizarEjecucionSecuencia();
    }
    
    showAlert('Secuencia reanudada después de evasión de obstáculo', 'success');
}




function obtenerEstadoCarrito() {
    return {
        moviendose: carritoEstado.moviendose,
        movimientoActual: carritoEstado.movimientoActual ? 
            Object.keys(OPERACION_MAP).find(key => OPERACION_MAP[key] === carritoEstado.movimientoActual) : 
            'Detenido',
        tiempoRestante: carritoEstado.moviendose ? 'En progreso...' : 'N/A'
    };
}

// --- AGREGAR función para ver estado (debug) ---
function verEstadoCarrito() {
    const estado = obtenerEstadoCarrito();
    console.log('📊 Estado del carrito:', estado);
    showAlert(`Estado: ${estado.movimientoActual} | En movimiento: ${estado.moviendose}`, 'info');
}

// --- MODIFICAR la inicialización para resetear estado ---

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Inicializando aplicación IoT Carrito...');
    
    // DETECCIÓN MEJORADA DE ENTORNO
    const isGitHubPages = window.location.hostname.includes('github.io');
    console.log(`📍 Entorno detectado: ${isGitHubPages ? 'GitHub Pages' : 'Desarrollo Local'}`);
    
    if (isGitHubPages) {
        console.log('🔒 Modo seguro: Usando HTTPS/WSS');
        showAlert('🔒 Conectando de forma segura desde GitHub Pages', 'info');
    } else {
        console.log('🔓 Modo desarrollo: Usando HTTP/WS');
    }

    // Esconder el resultado del obstáculo inicialmente
    const obstRes = document.getElementById('obstacleResult');
    if (obstRes) obstRes.classList.add('hidden');

    // Inicializar caches y estado
    movementCache = [];
    obstacleCache = [];
    carritoEstado = {
        moviendose: false,
        movimientoActual: null,
        timeoutMovimiento: null,
        duracionMovimiento: 2000 // 1 segundo
    };

    // Configurar displays iniciales
    clearMonitoringDisplays();

    // Inicializar ubicación real primero
    inicializarUbicacionReal().then(() => {
        console.log('📍 Ubicación inicializada:', ubicacionReal);
        
        // Conectar WebSockets (esto iniciará el monitoreo automático)
        connectWebSocket();

        // Cargar datos iniciales via REST (como fallback/backup)
        setTimeout(() => {
            loadMovementLogs();
            loadObstacleLogs();
        }, 1000);

        console.log('✅ Aplicación inicializada. WebSockets activos para monitoreo en tiempo real.');
        console.log('⏱️ Duración fija configurada: 1000ms para Adelante/Atrás');
    }).catch(error => {
        console.error('Error inicializando ubicación:', error);
        // Continuar incluso si falla la ubicación
        connectWebSocket();
        
        // Cargar datos incluso sin ubicación
        setTimeout(() => {
            loadMovementLogs();
            loadObstacleLogs();
        }, 1000);
    });
});
// --- 5. Manejo de Eventos WebSocket para Monitoreo ---

function handleMovementEvent(eventData) {
    if (!eventData) return;
    
    console.log('🔄 Procesando evento de movimiento:', eventData);
    
    // Actualizar cache
    const existingIndex = movementCache.findIndex(m => m.id === eventData.id);
    if (existingIndex >= 0) {
        movementCache[existingIndex] = eventData;
    } else {
        movementCache.unshift(eventData);
    }
    
    // Mantener máximo 50 elementos
    if (movementCache.length > 50) {
        movementCache = movementCache.slice(0, 50);
    }
    
    // Actualizar UI
    updateMovementDisplay();
}

function handleObstacleEvent(eventData) {
    if (!eventData) return;
    
    console.log('🔄 Procesando evento de obstáculo:', eventData);
    
    // Actualizar cache
    const existingIndex = obstacleCache.findIndex(o => o.id === eventData.id);
    if (existingIndex >= 0) {
        obstacleCache[existingIndex] = eventData;
    } else {
        obstacleCache.unshift(eventData);
    }
    
    // Mantener máximo 50 elementos
    if (obstacleCache.length > 50) {
        obstacleCache = obstacleCache.slice(0, 50);
    }
    
    // Actualizar UI
    updateObstacleDisplay();
}

function updateMovementDisplay() {
    const lastMovDiv = document.getElementById('lastMovement');
    const last10MovDiv = document.getElementById('last10Movements');
    
    if (movementCache.length > 0) {
        lastMovDiv.innerHTML = formatLogData(movementCache[0]);
        last10MovDiv.innerHTML = formatLogData(movementCache.slice(0, 10), true);
    } else {
        lastMovDiv.innerHTML = '<p class="text-secondary small">No hay movimientos recientes</p>';
        last10MovDiv.innerHTML = '<p class="text-secondary small">No hay movimientos para mostrar</p>';
    }
}

function updateObstacleDisplay() {
    const lastObstDiv = document.getElementById('lastObstacle');
    const last10ObstDiv = document.getElementById('last10Obstacles');
    
    if (obstacleCache.length > 0) {
        lastObstDiv.innerHTML = formatLogData(obstacleCache[0]);
        last10ObstDiv.innerHTML = formatLogData(obstacleCache.slice(0, 10), true);
    } else {
        lastObstDiv.innerHTML = '<p class="text-secondary small">No hay obstáculos recientes</p>';
        last10ObstDiv.innerHTML = '<p class="text-secondary small">No hay obstáculos para mostrar</p>';
    }
}

// --- 6. Funciones de Monitoreo (REST como fallback) ---

async function loadMovementLogs() {
    const lastMovDiv = document.getElementById('lastMovement');
    const last10MovDiv = document.getElementById('last10Movements');
    
    lastMovDiv.innerHTML = '<p class="text-info small">Cargando último movimiento...</p>';
    last10MovDiv.innerHTML = '<p class="text-info small">Cargando últimos 10 movimientos...</p>';
    
    try {
        // Cargar último movimiento
        const lastMov = await fetchData(`/movement/${DEVICE_NAME}/last`);
        if (lastMov && !Array.isArray(lastMov)) {
            movementCache.unshift(lastMov);
        }
        
        // Cargar últimos 10 movimientos
        const last10Mov = await fetchData(`/movement/${DEVICE_NAME}/last10`);
        if (last10Mov && Array.isArray(last10Mov)) {
            movementCache = [...last10Mov, ...movementCache.filter(m => 
                !last10Mov.find(lm => lm.id === m.id)
            )];
        }
        
        // Limitar cache
        movementCache = movementCache.slice(0, 50);
        
        updateMovementDisplay();
        
    } catch (error) {
        console.error('Error cargando movimientos:', error);
        // Mantener lo que haya en cache
        updateMovementDisplay();
    }
}

async function loadObstacleLogs() {
    const lastObstDiv = document.getElementById('lastObstacle');
    const last10ObstDiv = document.getElementById('last10Obstacles');
    
    lastObstDiv.innerHTML = '<p class="text-info small">Cargando último obstáculo...</p>';
    last10ObstDiv.innerHTML = '<p class="text-info small">Cargando últimos 10 obstáculos...</p>';
    
    try {
        // Cargar último obstáculo
        const lastObst = await fetchData(`/obstacle/${DEVICE_NAME}/last`);
        if (lastObst && !Array.isArray(lastObst)) {
            obstacleCache.unshift(lastObst);
        }
        
        // Cargar últimos 10 obstáculos
        const last10Obst = await fetchData(`/obstacle/${DEVICE_NAME}/last10`);
        if (last10Obst && Array.isArray(last10Obst)) {
            obstacleCache = [...last10Obst, ...obstacleCache.filter(o => 
                !last10Obst.find(lo => lo.id === o.id)
            )];
        }
        
        // Limitar cache
        obstacleCache = obstacleCache.slice(0, 50);
        
        updateObstacleDisplay();
        
    } catch (error) {
        console.error('Error cargando obstáculos:', error);
        // Mantener lo que haya en cache
        updateObstacleDisplay();
    }
}

// --- 7. Funciones para Demos (sin cambios) ---
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
    const nPasos = parseInt(document.getElementById('nPasos').value);
    const minMs = parseInt(document.getElementById('minMs').value);
    const maxMs = parseInt(document.getElementById('maxMs').value);
    const excluirDetener = document.getElementById('excluirDetener').checked;

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

    const results = await postData('/demo/random/', data);
    if (results && results.secuencia) {
        showAlert(`Demo Aleatoria ID ${results.secuencia.id} creada con ${results.secuencia.n_pasos} pasos.`, 'success');
        loadLast20Demos();
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
    
    // Limpiar ejecución anterior
    limpiarEjecucionSecuencia();
    
    postData(endpoint, {}).then(result => {
        if (result) {
            // Debug de la estructura
            debugSecuencia(result);
            
            // Debug de tiempos
            if (result.movimientos_programados) {
                debugTiemposSecuencia(result.movimientos_programados);
            }
            
            showAlert(`Repitiendo secuencia ID ${secuencia_id}. Monitoreo iniciado...`, 'info');
            
            // Iniciar monitoreo de la secuencia
            if (result.movimientos_programados && result.movimientos_programados.length > 0) {
                // Pequeño delay para asegurar que el backend haya programado los movimientos
                setTimeout(() => {
                    iniciarMonitoreoSecuencia(secuencia_id, result.movimientos_programados);
                }, 500);
            } else {
                showAlert('Error: La secuencia no tiene movimientos programados', 'danger');
            }
        }
    });
}

// Función para actualizar la ubicación periódicamente (opcional)
function iniciarActualizacionUbicacion() {
    // Actualizar cada 5 minutos
    setInterval(async () => {
        try {
            await inicializarUbicacionReal();
            console.log('📍 Ubicación actualizada:', ubicacionReal);
        } catch (error) {
            console.warn('Error actualizando ubicación:', error);
        }
    }, 5 * 60 * 1000); // 5 minutos
}

// Llamar esta función después de la inicialización si quieres ubicación en tiempo real
function actualizarUIUbicacion() {
    const ubicacionDiv = document.getElementById('ubicacionActual');
    if (!ubicacionDiv) return;
    
    ubicacionDiv.innerHTML = `
        <p class="small mb-1"><strong>IP:</strong> ${ubicacionReal.ip}</p>
        <p class="small mb-1"><strong>Ubicación:</strong> ${ubicacionReal.ciudad}, ${ubicacionReal.pais}</p>
        <p class="small mb-1"><strong>Coordenadas:</strong> ${ubicacionReal.lat ? ubicacionReal.lat.toFixed(6) : 'N/A'}, ${ubicacionReal.lon ? ubicacionReal.lon.toFixed(6) : 'N/A'}</p>
        <p class="small mb-0 text-secondary"><strong>Actualizado:</strong> ${new Date(ubicacionReal.timestamp).toLocaleString()}</p>
    `;
}

// Llamar esta función después de inicializarUbicacionReal()
// Función utilitaria para hacer elementos clickeables
function makeClickable() {
    document.querySelectorAll('.demo-item').forEach(item => {
        item.style.cursor = 'pointer';
        item.addEventListener('mouseenter', function() {
            this.style.backgroundColor = 'rgba(255,255,255,0.1)';
        });
        item.addEventListener('mouseleave', function() {
            this.style.backgroundColor = '';
        });
    });
}