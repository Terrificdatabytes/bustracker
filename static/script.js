// Complete script.js with Current Stop Display & Bus Capacity Management
// Global state
let socket;
let map;
let busMarkers = {};
let userMarker;
let stopMarkers = [];
let currentMode = null;
let currentRoute = null;
let trackingInterval = null;
let isSharing = false;
let isWaiting = false;
let currentWaitingStop = null;
let myBusId = null;
let updateInterval = null;
let driverInfo = null;
let isAuthenticated = false;
let isTracking = false;
let wakeLock = null;
let isBusFull = false; // NEW: Track bus capacity status

// Store previous values for animation detection
let previousValues = {
    speed: null,
    distance: null,
    eta: null,
    passengerEta: null,
    passengerDistance: null,
    passengerSpeed: null
};

// Wake Lock API - Prevent screen from turning off
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('✓ Screen wake lock activated');
            
            wakeLock.addEventListener('release', () => {
                console.log('Screen wake lock released');
            });
            
            document.addEventListener('visibilitychange', async () => {
                if (wakeLock !== null && document.visibilityState === 'visible') {
                    wakeLock = await navigator.wakeLock.request('screen');
                    console.log('✓ Screen wake lock re-acquired');
                }
            });
            
            return true;
        } else {
            console.log('⚠ Wake Lock API not supported');
            return false;
        }
    } catch (err) {
        console.error(`Wake Lock error: ${err.name}, ${err.message}`);
        return false;
    }
}

async function releaseWakeLock() {
    if (wakeLock !== null) {
        try {
            await wakeLock.release();
            wakeLock = null;
            console.log('✓ Screen wake lock released');
        } catch (err) {
            console.error(`Wake Lock release error: ${err}`);
        }
    }
}

// DOM Elements
const modeSelection = document.getElementById('modeSelection');
const routeSelection = document.getElementById('routeSelection');
const busUI = document.getElementById('busUI');
const passengerUI = document.getElementById('passengerUI');
const mapContainer = document.getElementById('mapContainer');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');
const statusDot = connectionStatus.querySelector('.status-dot');

// Driver Authentication Elements
const driverAuthModal = document.getElementById('driverAuthModal');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegisterBtn = document.getElementById('showRegister');
const showLoginBtn = document.getElementById('showLogin');

// NEW: Capacity Toggle Element
const capacityToggle = document.getElementById('capacityToggle');
const capacityStatusText = document.getElementById('capacityStatusText');

// Format distance display (km or meters)
function formatDistance(distanceKm) {
    if (distanceKm < 1) {
        const meters = Math.round(distanceKm * 1000);
        return `${meters} m`;
    } else {
        return `${distanceKm.toFixed(2)} km`;
    }
}

// TradingView-style animation helper
function animateValueChange(elementId, newValue, cardId = null) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const oldValue = element.textContent;
    
    if (oldValue === newValue.toString()) return;
    
    element.classList.add('number-change');
    
    const oldNum = parseFloat(oldValue);
    const newNum = parseFloat(newValue);
    
    if (cardId && !isNaN(oldNum) && !isNaN(newNum)) {
        const card = document.getElementById(cardId);
        if (card) {
            card.classList.remove('flash-up', 'flash-down', 'flash-update');
            
            if (newNum > oldNum) {
                card.classList.add('flash-up');
            } else if (newNum < oldNum) {
                card.classList.add('flash-down');
            } else {
                card.classList.add('flash-update');
            }
            
            setTimeout(() => {
                card.classList.remove('flash-up', 'flash-down', 'flash-update');
            }, 600);
        }
    }
    
    element.textContent = newValue;
    
    setTimeout(() => {
        element.classList.remove('number-change');
    }, 400);
}

// Animate info value changes
function animateInfoValue(elementId, newValue) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const oldValue = element.textContent;
    if (oldValue === newValue.toString()) return;
    
    element.classList.add('value-updating');
    element.textContent = newValue;
    
    setTimeout(() => {
        element.classList.remove('value-updating');
    }, 400);
}

// Initialize Socket.IO
function initSocket() {
    socket = io({
        transports: ['websocket', 'polling'],
        upgrade: true,
        rememberUpgrade: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
    });
    
    socket.on('connect', () => {
        console.log('✓ Connected to server');
        statusText.textContent = 'Connected';
        statusDot.classList.add('connected');
        
        if (driverInfo && currentMode === 'bus') {
            socket.emit('driver_authenticate', {
                driver_id: driverInfo.driver_id,
                password: driverInfo.password
            });
        }
        
        if (currentRoute && currentMode && (currentMode === 'passenger' || isAuthenticated)) {
            socket.emit('join_route', { 
                route_id: currentRoute, 
                mode: currentMode,
                bus_id: myBusId 
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('✗ Disconnected from server');
        statusText.textContent = 'Disconnected';
        statusDot.classList.remove('connected');
    });
    
    socket.on('connected', (data) => {
        console.log('Socket connected:', data);
    });
    
    socket.on('driver_authenticated', handleDriverAuthentication);
    socket.on('authentication_required', handleAuthenticationRequired);
    socket.on('bus_id_assigned', (data) => {
        myBusId = data.bus_id;
        console.log('✓ Assigned bus ID:', myBusId);
        document.getElementById('busId').textContent = myBusId;
        if (data.driver_name) {
            document.getElementById('driverName').textContent = data.driver_name;
        }
    });
    
    socket.on('bus_update', handleBusUpdate);
    socket.on('all_buses_update', handleAllBusesUpdate);
    socket.on('bus_removed', handleBusRemoved);
    socket.on('bus_count_update', handleBusCountUpdate);
    socket.on('waiting_update', handleWaitingUpdate);
    socket.on('waiting_stats', handleWaitingStats);
    socket.on('bus_info_update', handleBusInfoUpdate);
    
    // NEW: Listen for capacity update confirmation
    socket.on('capacity_updated', (data) => {
        console.log('✓ Capacity updated:', data.message);
    });
}

function handleDriverAuthentication(data) {
    if (data.success) {
        isAuthenticated = true;
        driverInfo.driver_id = data.driver.driver_id;
        driverInfo.name = data.driver.name;
        driverAuthModal.style.display = 'none';
        console.log('✓ Driver authenticated successfully');
        
        if (currentRoute) {
            socket.emit('join_route', { route_id: currentRoute, mode: 'bus' });
        }
    } else {
        alert(data.message || 'Authentication failed');
        isAuthenticated = false;
    }
}

function handleAuthenticationRequired(data) {
    alert(data.message);
    showDriverAuthModal();
}

function showDriverAuthModal() {
    driverAuthModal.style.display = 'flex';
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
}

function handleBusInfoUpdate(data) {
    // Update driver panel with real-time info and animations
    animateValueChange('busSpeed', data.speed, 'speedCard');
    animateValueChange('nearestStopDriver', data.nearest_stop, 'stopCard');
    animateValueChange('distanceToStop', formatDistance(data.distance_to_stop), 'distanceCard');
    animateValueChange('etaToStop', data.eta_to_stop, 'etaCard');
    
    // NEW: Display current stop if bus is at a stop
    const currentStopDisplay = document.getElementById('currentStopDisplay');
    const currentStopName = document.getElementById('currentStopName');
    
    if (data.current_stop) {
        currentStopDisplay.classList.remove('hidden');
        currentStopName.textContent = data.current_stop;
    } else {
        currentStopDisplay.classList.add('hidden');
    }
}

// NEW: Bus Capacity Toggle Handler
if (capacityToggle) {
    capacityToggle.addEventListener('change', function() {
        isBusFull = this.checked;
        
        // Update UI
        if (isBusFull) {
            capacityStatusText.textContent = 'Bus Full';
            capacityStatusText.classList.remove('available');
            capacityStatusText.classList.add('full');
        } else {
            capacityStatusText.textContent = 'Bus Available';
            capacityStatusText.classList.remove('full');
            capacityStatusText.classList.add('available');
        }
        
        // Notify server
        if (myBusId && currentRoute) {
            socket.emit('bus_capacity_update', {
                bus_id: myBusId,
                route_id: currentRoute,
                is_full: isBusFull
            });
            
            console.log(`✓ Bus capacity updated: ${isBusFull ? 'FULL' : 'AVAILABLE'}`);
        }
    });
}

document.getElementById('loginBtn').addEventListener('click', async () => {
    const driverId = document.getElementById('loginDriverId').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!driverId || !password) {
        alert('Please enter Driver ID and Password');
        return;
    }
    
    driverInfo = { driver_id: driverId, password: password };
    
    socket.emit('driver_authenticate', {
        driver_id: driverId,
        password: password
    });
});

document.getElementById('loginPassword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('loginBtn').click();
    }
});

document.getElementById('registerBtn').addEventListener('click', async () => {
    const driverId = document.getElementById('regDriverId').value.trim();
    const password = document.getElementById('regPassword').value;
    const name = document.getElementById('regName').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const license = document.getElementById('regLicense').value.trim();
    
    if (!driverId || !password || !name || !phone || !license) {
        alert('Please fill all fields');
        return;
    }
    
    try {
        const response = await fetch('/api/driver/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                driver_id: driverId,
                password: password,
                name: name,
                phone: phone,
                license_number: license
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Registration successful! Please login.');
            showLoginBtn.click();
            document.getElementById('loginDriverId').value = driverId;
        } else {
            alert(data.message || 'Registration failed');
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('Registration failed. Please try again.');
    }
});

showRegisterBtn.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
});

showLoginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
});

async function loadRoutes() {
    try {
        const response = await fetch('/api/routes');
        const data = await response.json();
        
        const routeSelect = document.getElementById('routeSelect');
        data.routes.forEach(route => {
            const option = document.createElement('option');
            option.value = route;
            option.textContent = `Route ${route}`;
            routeSelect.appendChild(option);
        });
        
        window.stopsData = data.stops;
    } catch (error) {
        console.error('Error loading routes:', error);
    }
}

function initMap(centerLat = 9.9252, centerLng = 78.1198) {
    if (map) {
        map.remove();
    }
    
    map = L.map('map', {
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
        zoomControl: true
    }).setView([centerLat, centerLng], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        updateWhenIdle: false,
        updateWhenZooming: false,
        keepBuffer: 2
    }).addTo(map);
    
    return map;
}

function addStopMarkers(route) {
    stopMarkers.forEach(marker => map.removeLayer(marker));
    stopMarkers = [];
    
    if (!window.stopsData || !window.stopsData[route]) return;
    
    const stops = window.stopsData[route];
    
    stops.forEach(stop => {
        const marker = L.marker([stop.lat, stop.lng], {
            icon: L.divIcon({
                className: 'custom-marker',
                html: `<div style="background: #2196F3; color: white; padding: 5px 10px; border-radius: 20px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); white-space: nowrap;">
                    ${stop.id}
                </div>`,
                iconSize: [40, 40]
            })
        }).addTo(map);
        
        marker.bindPopup(`
            <div class="custom-popup">
                <h4>${stop.name}</h4>
                <p>Stop ID: ${stop.id}</p>
            </div>
        `);
        
        stopMarkers.push(marker);
    });
}

document.getElementById('busMode').addEventListener('click', () => {
    currentMode = 'bus';
    modeSelection.classList.add('hidden');
    routeSelection.classList.remove('hidden');
});

document.getElementById('passengerMode').addEventListener('click', () => {
    currentMode = 'passenger';
    modeSelection.classList.add('hidden');
    routeSelection.classList.remove('hidden');
});

document.getElementById('routeSelect').addEventListener('change', (e) => {
    currentRoute = e.target.value;
    
    if (!currentRoute) return;
    
    if (currentMode === 'bus') {
        setupBusMode();
    } else {
        setupPassengerMode();
    }
});

function setupBusMode() {
    showDriverAuthModal();
    
    routeSelection.classList.add('hidden');
    busUI.classList.remove('hidden');
    mapContainer.classList.remove('hidden');
    
    document.getElementById('busRoute').textContent = currentRoute;
    
    const stops = window.stopsData[currentRoute];
    if (stops && stops.length > 0) {
        initMap(stops[0].lat, stops[0].lng);
        addStopMarkers(currentRoute);
    } else {
        initMap();
    }
}

function setupPassengerMode() {
    routeSelection.classList.add('hidden');
    passengerUI.classList.remove('hidden');
    mapContainer.classList.remove('hidden');
    
    document.getElementById('passengerRoute').textContent = currentRoute;
    
    const waitingStopSelect = document.getElementById('waitingStopSelect');
    waitingStopSelect.innerHTML = '<option value="">-- Select your stop --</option>';
    
    const stops = window.stopsData[currentRoute];
    if (stops) {
        stops.forEach(stop => {
            const option = document.createElement('option');
            option.value = stop.id;
            option.textContent = `${stop.name} (Stop ${stop.id})`;
            waitingStopSelect.appendChild(option);
        });
    }
    
    if (stops && stops.length > 0) {
        initMap(stops[0].lat, stops[0].lng);
        addStopMarkers(currentRoute);
    } else {
        initMap();
    }
    
    socket.emit('join_route', { route_id: currentRoute, mode: 'passenger' });
    
    loadWaitingStats();
}

document.getElementById('trafficLevel').addEventListener('input', (e) => {
    document.getElementById('trafficValue').textContent = parseFloat(e.target.value).toFixed(1);
});

document.getElementById('startSharing').addEventListener('click', async () => {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
    }
    
    if (!myBusId) {
        alert('Bus ID not assigned yet. Please wait...');
        return;
    }
    
    if (!isAuthenticated) {
        alert('Please authenticate first');
        showDriverAuthModal();
        return;
    }
    
    isSharing = true;
    document.getElementById('startSharing').classList.add('hidden');
    document.getElementById('stopSharing').classList.remove('hidden');
    document.getElementById('busStatus').textContent = 'Sharing Location (Live)';
    document.getElementById('busStatus').style.color = '#4CAF50';
    document.getElementById('recenterMap').style.display = 'inline-flex';
    
    document.getElementById('driverStats').classList.remove('hidden');
    
    const wakeLockEnabled = await requestWakeLock();
    if (wakeLockEnabled) {
        console.log('✓ Screen will stay on while sharing location');
    }
    
    trackingInterval = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            const trafficLevel = parseFloat(document.getElementById('trafficLevel').value);
            
            console.log(`📍 Location update: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
            
            socket.emit('bus_location', {
                route_id: currentRoute,
                bus_id: myBusId,
                lat: latitude,
                lng: longitude,
                traffic_level: trafficLevel
            });
            
            updateBusMarker(myBusId, latitude, longitude, true);
        },
        (error) => {
            console.error('Geolocation error:', error);
            if (error.code === error.PERMISSION_DENIED) {
                alert('Location permission denied. Please enable location services.');
                document.getElementById('stopSharing').click();
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        }
    );
});

document.getElementById('stopSharing').addEventListener('click', () => {
    isSharing = false;
    
    if (trackingInterval) {
        navigator.geolocation.clearWatch(trackingInterval);
        trackingInterval = null;
    }
    
    socket.emit('leave_route', { 
        route_id: currentRoute, 
        mode: 'bus',
        bus_id: myBusId 
    });
    
    document.getElementById('stopSharing').classList.add('hidden');
    document.getElementById('startSharing').classList.remove('hidden');
    document.getElementById('busStatus').textContent = 'Stopped';
    document.getElementById('busStatus').style.color = '#666';
    document.getElementById('driverStats').classList.add('hidden');
    document.getElementById('recenterMap').style.display = 'none';
    document.getElementById('currentStopDisplay').classList.add('hidden');
    
    releaseWakeLock();
    
    if (busMarkers[myBusId]) {
        map.removeLayer(busMarkers[myBusId]);
        delete busMarkers[myBusId];
    }
});

function updateBusMarker(busId, lat, lng, isOwnBus = false, driverName = null, direction = 'forward') {
    if (!map) {
        console.error('Map not initialized!');
        return;
    }
    
    const color = isOwnBus ? '#4CAF50' : '#FF9800';
    
    let label;
    if (isOwnBus) {
        label = direction === 'forward' ? '🚌→' : '🚌←';
    } else {
        label = direction === 'forward' ? '🚍→' : '🚍←';
    }
    
    if (busMarkers[busId]) {
        busMarkers[busId].setLatLng([lat, lng]);
        busMarkers[busId].setIcon(L.divIcon({
            className: 'bus-marker',
            html: `<div style="background: ${color}; color: white; padding: 8px; border-radius: 50%; font-size: 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); white-space: nowrap;">${label}</div>`,
            iconSize: [50, 40]
        }));
        busMarkers[busId]._direction = direction;
    } else {
        busMarkers[busId] = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'bus-marker',
                html: `<div style="background: ${color}; color: white; padding: 8px; border-radius: 50%; font-size: 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); white-space: nowrap;">${label}</div>`,
                iconSize: [50, 40]
            })
        }).addTo(map);
        
        busMarkers[busId]._direction = direction;
        
        const directionText = direction === 'forward' ? 'Forward' : 'Backward';
        const popupText = driverName ? `Driver: ${driverName}` : (isOwnBus ? 'Your Bus' : 'Active Bus');
        
        busMarkers[busId].bindPopup(`
            <div class="custom-popup">
                <h4>${label} Bus ${busId.substring(0, 8)}</h4>
                <p>${popupText}</p>
                <p><strong>Direction:</strong> ${directionText}</p>
            </div>
        `);
        
        // Only center on first bus marker when initially added, then allow free panning
        if (Object.keys(busMarkers).length === 1) {
            map.setView([lat, lng], 14);
        }
    }
    
    // Map is always unlocked - users can freely pan and zoom
}

function removeBusMarker(busId) {
    if (busMarkers[busId]) {
        map.removeLayer(busMarkers[busId]);
        delete busMarkers[busId];
    }
}

function showMessage(status, route) {
    const etaInfoDiv = document.getElementById('etaInfo');
    const trackingMsg = etaInfoDiv ? etaInfoDiv.querySelector('p') : null;
    const etaDisplay = etaInfoDiv ? etaInfoDiv.querySelector('.eta-display') : null;
    
    const messages = {
        loading: `🔍 Searching for buses on Route ${route}...`,
        found: `✅ Bus found on Route ${route}! Tracking now...`,
        nobus: `❌ No buses found on Route ${route}. All buses may be full or inactive.`,
        error: `⚠️ Error loading buses on Route ${route}. Please try again.`,
        multiple: `✅ Multiple buses found on Route ${route}! Displaying closest bus...`
    };
    
    if (trackingMsg) {
        trackingMsg.textContent = messages[status] || messages.loading;
        trackingMsg.style.display = 'block';
    }
    
    if (status === 'found' || status === 'multiple') {
        if (etaDisplay) {
            etaDisplay.style.display = 'grid';
        }
    } else if (status === 'nobus' || status === 'loading' || status === 'error') {
        if (etaDisplay) {
            etaDisplay.style.display = 'none';
        }
    }
}

const trackBusBtn = document.getElementById('trackBus');
if (trackBusBtn) {
    trackBusBtn.addEventListener('click', async () => {
        console.log('=== TRACK BUS CLICKED ===');
        
        if (!map) {
            alert('Map not initialized. Please refresh the page.');
            return;
        }
        
        if (!currentRoute) {
            alert('No route selected!');
            return;
        }
        
        isTracking = true;
        trackBusBtn.classList.add('hidden');
        document.getElementById('stopTracking').classList.remove('hidden');
        document.getElementById('etaInfo').classList.remove('hidden');
        document.getElementById('recenterMap').style.display = 'inline-flex';
        
        const wakeLockEnabled = await requestWakeLock();
        if (wakeLockEnabled) {
            console.log('✓ Screen will stay on while tracking bus');
        }
        
        showMessage('loading', currentRoute);
        
        loadActiveBuses();
        updateInterval = setInterval(loadActiveBuses, 2000);
    });
}

document.getElementById('stopTracking').addEventListener('click', () => {
    isTracking = false;
    document.getElementById('stopTracking').classList.add('hidden');
    document.getElementById('trackBus').classList.remove('hidden');
    document.getElementById('etaInfo').classList.add('hidden');
    document.getElementById('recenterMap').style.display = 'none';
    document.getElementById('passengerCurrentStopDisplay').classList.add('hidden');
    
    releaseWakeLock();
    
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    
    Object.keys(busMarkers).forEach(busId => {
        if (busMarkers[busId]) {
            map.removeLayer(busMarkers[busId]);
        }
    });
    busMarkers = {};
});

// Recenter map button handler
document.getElementById('recenterMap').addEventListener('click', () => {
    const busIds = Object.keys(busMarkers);
    
    if (busIds.length === 0) {
        alert('No buses to center on');
        return;
    }
    
    if (busIds.length === 1) {
        const marker = busMarkers[busIds[0]];
        const latlng = marker.getLatLng();
        map.setView([latlng.lat, latlng.lng], 15);
    } else {
        const bounds = L.latLngBounds();
        busIds.forEach(busId => {
            const marker = busMarkers[busId];
            if (marker) {
                bounds.extend(marker.getLatLng());
            }
        });
        map.fitBounds(bounds, { padding: [50, 50] });
    }
});

async function loadActiveBuses() {
    try {
        const url = `/api/active_buses/${currentRoute}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.buses && data.buses.length > 0) {
            if (data.buses.length === 1) {
                showMessage('found', currentRoute);
            } else {
                showMessage('multiple', currentRoute);
            }
            
            const activeBusIds = [];
            
            data.buses.forEach(bus => {
                activeBusIds.push(bus.bus_id);
                const direction = bus.direction || 'forward';
                updateBusMarker(bus.bus_id, bus.lat, bus.lng, false, bus.driver_name, direction);
            });
            
            Object.keys(busMarkers).forEach(busId => {
                if (!activeBusIds.includes(busId)) {
                    removeBusMarker(busId);
                }
            });
            
            updateClosestBusETA();
        } else {
            showMessage('nobus', currentRoute);
            
            Object.keys(busMarkers).forEach(busId => {
                removeBusMarker(busId);
            });
            
            animateValueChange('etaMinutes', '--', 'passengerEtaCard');
            animateValueChange('distance', '--', 'passengerDistanceCard');
            animateValueChange('busLocationStop', 'No buses active', 'passengerStopCard');
            animateValueChange('busSpeedPassenger', '--', 'passengerSpeedCard');
            
            // Hide current stop display
            document.getElementById('passengerCurrentStopDisplay').classList.add('hidden');
        }
    } catch (error) {
        console.error('Error loading active buses:', error);
        showMessage('error', currentRoute);
    }
}

document.getElementById('waitingToggle').addEventListener('click', function() {
    const stopSelect = document.getElementById('waitingStopSelect');
    const stopId = parseInt(stopSelect.value);
    
    if (!stopId) {
        alert('Please select a stop first');
        return;
    }
    
    isWaiting = !isWaiting;
    
    socket.emit('passenger_waiting', {
        route_id: currentRoute,
        stop_id: stopId,
        is_waiting: isWaiting
    });
    
    if (isWaiting) {
        this.textContent = 'Cancel Waiting';
        this.classList.remove('btn-info');
        this.classList.add('btn-danger');
        currentWaitingStop = stopId;
    } else {
        this.textContent = "I'm Waiting at This Stop";
        this.classList.remove('btn-danger');
        this.classList.add('btn-info');
        currentWaitingStop = null;
    }
});

function handleBusUpdate(data) {
    const direction = data.direction || 'forward';
    updateBusMarker(data.bus_id, data.lat, data.lng, false, data.driver_name, direction);
    
    if (isTracking) {
        updateClosestBusETA();
    }
}

function handleAllBusesUpdate(data) {
    if (data.buses && data.buses.length > 0) {
        data.buses.forEach(bus => {
            const direction = bus.direction || 'forward';
            updateBusMarker(bus.bus_id, bus.lat, bus.lng, false, bus.driver_name, direction);
        });
        
        if (isTracking) {
            updateClosestBusETA();
        }
    }
}

function handleBusRemoved(data) {
    removeBusMarker(data.bus_id);
    
    // Show message if bus was removed because it's full
    if (data.reason === 'full' && currentMode === 'passenger') {
        console.log('ℹ️ Bus marked as full and hidden from view');
    }
    
    if (isTracking) {
        updateClosestBusETA();
    }
}

function updateClosestBusETA() {
    const allBusIds = Object.keys(busMarkers);
    
    if (allBusIds.length === 0) {
        animateValueChange('etaMinutes', '--', 'passengerEtaCard');
        animateValueChange('distance', '--', 'passengerDistanceCard');
        animateValueChange('busLocationStop', 'No buses active', 'passengerStopCard');
        animateValueChange('busSpeedPassenger', '--', 'passengerSpeedCard');
        document.getElementById('passengerCurrentStopDisplay').classList.add('hidden');
        return;
    }
    
    const waitingStopSelect = document.getElementById('waitingStopSelect');
    const selectedStopId = parseInt(waitingStopSelect.value);
    const stops = window.stopsData[currentRoute];
    
    let referenceStop = stops && stops.length > 0 ? stops[0] : null;
    
    if (selectedStopId && stops) {
        const userStop = stops.find(s => s.id === selectedStopId);
        if (userStop) {
            referenceStop = userStop;
        }
    }
    
    if (!referenceStop) {
        animateValueChange('etaMinutes', '--', 'passengerEtaCard');
        animateValueChange('distance', '--', 'passengerDistanceCard');
        animateValueChange('busLocationStop', 'Stop data unavailable', 'passengerStopCard');
        animateValueChange('busSpeedPassenger', '--', 'passengerSpeedCard');
        return;
    }
    
    let closestBus = null;
    let minDistance = Infinity;
    
    allBusIds.forEach(busId => {
        const marker = busMarkers[busId];
        if (!marker) return;
        
        const latlng = marker.getLatLng();
        const dist = calculateDistance(referenceStop.lat, referenceStop.lng, latlng.lat, latlng.lng);
        
        if (dist < minDistance) {
            minDistance = dist;
            closestBus = busId;
        }
    });
    
    if (closestBus && minDistance !== Infinity) {
        const trafficLevel = 1.5;
        const etaMinutes = predictETA(minDistance, trafficLevel);
        
        // Fetch and display next stop info
        fetch(`/api/active_buses/${currentRoute}`)
            .then(res => res.json())
            .then(data => {
                const busData = data.buses.find(b => b.bus_id === closestBus);
                if (busData) {
                    animateValueChange('busSpeedPassenger', `${busData.speed} km/h`, 'passengerSpeedCard');
                    
                    // NEW: Display current stop if bus is at a stop
                    const passengerCurrentStopDisplay = document.getElementById('passengerCurrentStopDisplay');
                    const passengerCurrentStopName = document.getElementById('passengerCurrentStopName');
                    
                    if (busData.current_stop) {
                        passengerCurrentStopDisplay.classList.remove('hidden');
                        passengerCurrentStopName.textContent = busData.current_stop;
                    } else {
                        passengerCurrentStopDisplay.classList.add('hidden');
                    }
                    
                    // Show bus's NEXT stop in the Next Stop field
                    animateValueChange('busLocationStop', busData.next_stop || busData.nearest_stop || 'En route', 'passengerStopCard');
                }
            });
        
        animateValueChange('etaMinutes', Math.round(etaMinutes), 'passengerEtaCard');
        animateValueChange('distance', formatDistance(minDistance), 'passengerDistanceCard');
    } else {
        animateValueChange('etaMinutes', '--', 'passengerEtaCard');
        animateValueChange('distance', '--', 'passengerDistanceCard');
        animateValueChange('busLocationStop', 'Calculating...', 'passengerStopCard');
        animateValueChange('busSpeedPassenger', '--', 'passengerSpeedCard');
    }
}

function predictETA(distanceKm, trafficLevel) {
    const baseSpeed = 30;
    const speed = baseSpeed / trafficLevel;
    return (distanceKm / speed) * 60;
}

function handleBusCountUpdate(data) {
    animateInfoValue('busCount', data.count);
}

function handleWaitingUpdate(data) {
    loadWaitingStats();
}

function handleWaitingStats(data) {
    updateWaitingDisplay(data);
}

async function loadWaitingStats() {
    try {
        const response = await fetch('/api/waiting_stats');
        const data = await response.json();
        updateWaitingDisplay(data);
    } catch (error) {
        console.error('Error loading waiting stats:', error);
    }
}

function updateWaitingDisplay(stats) {
    const waitingList = document.getElementById('waitingList');
    
    if (!stats || !stats[currentRoute]) {
        waitingList.innerHTML = '<p style="text-align: center; color: #999;">No one waiting currently</p>';
        return;
    }
    
    const routeStats = stats[currentRoute];
    const stops = window.stopsData[currentRoute];
    
    let html = '';
    Object.entries(routeStats).forEach(([stopId, count]) => {
        if (count > 0) {
            const stop = stops.find(s => s.id === parseInt(stopId));
            const stopName = stop ? stop.name : `Stop ${stopId}`;
            
            html += `
                <div class="waiting-list-item">
                    <span>${stopName}</span>
                    <span class="waiting-count">${count} waiting</span>
                </div>
            `;
        }
    });
    
    if (html === '') {
        html = '<p style="text-align: center; color: #999;">No one waiting currently</p>';
    }
    
    waitingList.innerHTML = html;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(degrees) {
    return degrees * (Math.PI / 180);
}

window.addEventListener('beforeunload', () => {
    if (isSharing && myBusId) {
        if (trackingInterval) {
            navigator.geolocation.clearWatch(trackingInterval);
        }
        
        socket.emit('leave_route', { 
            route_id: currentRoute, 
            mode: 'bus',
            bus_id: myBusId 
        });
    }
    
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    
    releaseWakeLock();
});

console.log('=== Initializing Enhanced Bus Tracking System ===');
console.log('✓ Current stop detection enabled');
console.log('✓ Bus capacity management enabled');
console.log('✓ Full buses hidden from passenger view');
console.log('✓ Next stop display for passengers');
console.log('✓ TradingView-style animations enabled');
console.log('✓ Continuous GPS tracking with watchPosition');
console.log('Script loaded at:', new Date().toLocaleTimeString());

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM Content Loaded');
        initSocket();
        loadRoutes();
    });
} else {
    console.log('DOM already loaded');
    initSocket();
    loadRoutes();
}

window.addEventListener('load', () => {
    console.log('=== Page Fully Loaded ===');
    console.log('✓ All elements loaded');
    console.log('✓ Animation system ready');
    console.log('✓ Capacity toggle ready');
    console.log('✓ Track Bus button exists:', !!document.getElementById('trackBus'));
    console.log('✓ Passenger UI exists:', !!document.getElementById('passengerUI'));
    console.log('✓ Map container exists:', !!document.getElementById('map'));
});
