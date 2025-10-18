// Complete script.js with Bidirectional Bus Tracking Support
// Replace your existing script.js with this

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
    // Update driver panel with real-time info
    document.getElementById('busSpeed').textContent = data.speed;
    document.getElementById('nearestStopDriver').textContent = data.nearest_stop;
    document.getElementById('distanceToStop').textContent = data.distance_to_stop;
    document.getElementById('etaToStop').textContent = data.eta_to_stop;
    
    // Add direction indicator
    const directionEl = document.getElementById('busDirection');
    if (directionEl && data.direction) {
        const directionText = data.direction === 'forward' ? 'Forward ➡️' : 'Backward ⬅️';
        directionEl.textContent = directionText;
        directionEl.style.color = data.direction === 'forward' ? '#4CAF50' : '#FF9800';
    }
    
    // Add progress indicator
    const progressEl = document.getElementById('busProgress');
    if (progressEl && data.progress_pct !== undefined) {
        progressEl.textContent = `${data.progress_pct}%`;
    }
    
    // Update stops passed indicator
    const stopsPassedEl = document.getElementById('stopsPassedCount');
    if (stopsPassedEl && data.stops_passed !== undefined && data.total_stops !== undefined) {
        stopsPassedEl.textContent = `${data.stops_passed} / ${data.total_stops}`;
    }
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

document.getElementById('startSharing').addEventListener('click', () => {
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
    
    // Show driver stats panel
    document.getElementById('driverStats').classList.remove('hidden');
    
    shareLocation();
    
    // Update every 1 second with proper timing
    trackingInterval = setInterval(shareLocation, 1000);
});

document.getElementById('stopSharing').addEventListener('click', () => {
    isSharing = false;
    clearInterval(trackingInterval);
    
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
    
    if (busMarkers[myBusId]) {
        map.removeLayer(busMarkers[myBusId]);
        delete busMarkers[myBusId];
    }
});

function shareLocation() {
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            
            const trafficLevel = parseFloat(document.getElementById('trafficLevel').value);
            
            socket.emit('bus_location', {
                route_id: currentRoute,
                bus_id: myBusId,
                lat: latitude,
                lng: longitude,
                traffic_level: trafficLevel
            });
            
            // Get current direction from last update
            const currentDirection = busMarkers[myBusId] ? 
                (busMarkers[myBusId]._direction || 'forward') : 'forward';
            
            updateBusMarker(myBusId, latitude, longitude, true, null, currentDirection);
            
            // Only auto-center if not manually panned
            if (!map._userPanned) {
                map.setView([latitude, longitude], map.getZoom());
            }
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
}

// Track if user manually panned the map
if (map) {
    map.on('dragstart', function() {
        map._userPanned = true;
        setTimeout(() => { map._userPanned = false; }, 10000); // Reset after 10s
    });
}

function updateBusMarker(busId, lat, lng, isOwnBus = false, driverName = null, direction = 'forward') {
    if (!map) {
        console.error('Map not initialized!');
        return;
    }
    
    const color = isOwnBus ? '#4CAF50' : '#FF9800';
    
    // Choose emoji based on direction
    let label;
    if (isOwnBus) {
        label = direction === 'forward' ? '🚌→' : '🚌←';
    } else {
        label = direction === 'forward' ? '🚍→' : '🚍←';
    }
    
    if (busMarkers[busId]) {
        busMarkers[busId].setLatLng([lat, lng]);
        // Update icon to reflect direction change
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
    }
    
    if (Object.keys(busMarkers).length === 1 && !map._userPanned) {
        map.setView([lat, lng], 14);
    }
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
        nobus: `❌ No buses found on Route ${route}....`,
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
    trackBusBtn.addEventListener('click', () => {
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
            
            const etaMinutesEl = document.getElementById('etaMinutes');
            const distanceEl = document.getElementById('distance');
            const nearestStopEl = document.getElementById('nearestStop');
            const busSpeedEl = document.getElementById('busSpeedPassenger');
            
            if (etaMinutesEl) etaMinutesEl.textContent = '--';
            if (distanceEl) distanceEl.textContent = '-- km';
            if (nearestStopEl) nearestStopEl.textContent = 'No buses active';
            if (busSpeedEl) busSpeedEl.textContent = '-- km/h';
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
    if (isTracking) {
        updateClosestBusETA();
    }
}

function updateClosestBusETA() {
    const etaMinutesEl = document.getElementById('etaMinutes');
    const distanceEl = document.getElementById('distance');
    const nearestStopEl = document.getElementById('nearestStop');
    const busSpeedEl = document.getElementById('busSpeedPassenger');
    const etaInfoDiv = document.getElementById('etaInfo');
    const etaDisplay = etaInfoDiv ? etaInfoDiv.querySelector('.eta-display') : null;
    
    const allBusIds = Object.keys(busMarkers);
    
    if (allBusIds.length === 0) {
        if (etaMinutesEl) etaMinutesEl.textContent = '--';
        if (distanceEl) distanceEl.textContent = '-- km';
        if (nearestStopEl) nearestStopEl.textContent = 'No buses active';
        if (busSpeedEl) busSpeedEl.textContent = '-- km/h';
        if (etaDisplay) etaDisplay.style.display = 'none';
        return;
    }
    
    if (etaDisplay) {
        etaDisplay.style.display = 'grid';
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
        if (etaMinutesEl) etaMinutesEl.textContent = '--';
        if (distanceEl) distanceEl.textContent = '-- km';
        if (nearestStopEl) nearestStopEl.textContent = 'Stop data unavailable';
        if (busSpeedEl) busSpeedEl.textContent = '-- km/h';
        if (etaDisplay) etaDisplay.style.display = 'none';
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
        
        // Get speed and direction from active buses data
        fetch(`/api/active_buses/${currentRoute}`)
            .then(res => res.json())
            .then(data => {
                const busData = data.buses.find(b => b.bus_id === closestBus);
                if (busData) {
                    if (busSpeedEl) {
                        busSpeedEl.textContent = `${busData.speed} km/h`;
                    }
                    // Update direction indicator for passenger
                    const busDirectionEl = document.getElementById('busDirectionPassenger');
                    if (busDirectionEl && busData.direction) {
                        const dirText = busData.direction === 'forward' ? 'Forward ➡️' : 'Backward ⬅️';
                        busDirectionEl.textContent = dirText;
                        busDirectionEl.style.color = busData.direction === 'forward' ? '#4CAF50' : '#FF9800';
                    }
                }
            });
        
        if (etaMinutesEl) {
            etaMinutesEl.textContent = Math.round(etaMinutes);
        }
        if (distanceEl) {
            distanceEl.textContent = `${minDistance.toFixed(2)} km`;
        }
        if (nearestStopEl) {
            nearestStopEl.textContent = referenceStop.name;
        }
        
        if (etaDisplay) {
            etaDisplay.style.display = 'grid';
        }
    } else {
        if (etaMinutesEl) etaMinutesEl.textContent = '--';
        if (distanceEl) distanceEl.textContent = '-- km';
        if (nearestStopEl) nearestStopEl.textContent = 'Calculating...';
        if (busSpeedEl) busSpeedEl.textContent = '-- km/h';
    }
}

function predictETA(distanceKm, trafficLevel) {
    const baseSpeed = 30;
    const speed = baseSpeed / trafficLevel;
    return (distanceKm / speed) * 60;
}

function handleBusCountUpdate(data) {
    const busCountEl = document.getElementById('busCount');
    if (busCountEl) {
        busCountEl.textContent = data.count;
    }
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
        socket.emit('leave_route', { 
            route_id: currentRoute, 
            mode: 'bus',
            bus_id: myBusId 
        });
    }
    
    if (trackingInterval) {
        clearInterval(trackingInterval);
    }
    
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});

console.log('=== Initializing Bidirectional Bus Tracking System ===');
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
    console.log('✓ Track Bus button exists:', !!document.getElementById('trackBus'));
    console.log('✓ Passenger UI exists:', !!document.getElementById('passengerUI'));
    console.log('✓ Map container exists:', !!document.getElementById('map'));
});
