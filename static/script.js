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
        console.log('Connected to server');
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
        console.log('Disconnected from server');
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
        console.log('Assigned bus ID:', myBusId);
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
}

function handleDriverAuthentication(data) {
    if (data.success) {
        isAuthenticated = true;
        driverInfo.driver_id = data.driver.driver_id;
        driverInfo.name = data.driver.name;
        driverAuthModal.style.display = 'none';
        console.log('Driver authenticated successfully');
        
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
    
    map = L.map('map').setView([centerLat, centerLng], 13);
    
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
    
    shareLocation();
    
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
            
            updateBusMarker(myBusId, latitude, longitude, true);
            
            map.setView([latitude, longitude], map.getZoom());
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

function updateBusMarker(busId, lat, lng, isOwnBus = false, driverName = null) {
    console.log(`updateBusMarker called: ${busId}, lat: ${lat}, lng: ${lng}, map exists: ${!!map}`);
    
    if (!map) {
        console.error('Map not initialized!');
        return;
    }
    
    const color = isOwnBus ? '#4CAF50' : '#FF9800';
    const label = isOwnBus ? '🚌' : '🚍';
    
    if (busMarkers[busId]) {
        busMarkers[busId].setLatLng([lat, lng]);
        console.log(`Updated existing marker for bus ${busId}`);
    } else {
        busMarkers[busId] = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'bus-marker',
                html: `<div style="background: ${color}; color: white; padding: 8px; border-radius: 50%; font-size: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${label}</div>`,
                iconSize: [40, 40]
            })
        }).addTo(map);
        
        const popupText = driverName ? `Driver: ${driverName}` : (isOwnBus ? 'Your Bus' : 'Active Bus');
        
        busMarkers[busId].bindPopup(`
            <div class="custom-popup">
                <h4>${label} Bus ${busId.substring(0, 8)}</h4>
                <p>${popupText}</p>
            </div>
        `);
        
        console.log(`Created new marker for bus ${busId}`);
    }
    
    if (Object.keys(busMarkers).length === 1) {
        map.setView([lat, lng], 14);
        console.log('Panned map to first bus location');
    }
}

function removeBusMarker(busId) {
    if (busMarkers[busId]) {
        map.removeLayer(busMarkers[busId]);
        delete busMarkers[busId];
        console.log(`Removed bus marker for ${busId}`);
    }
}

// Display messages based on bus status
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
        trackingMsg.style.fontSize = '16px';
        trackingMsg.style.fontWeight = 'bold';
        trackingMsg.style.padding = '15px';
        trackingMsg.style.textAlign = 'center';
        trackingMsg.style.color = status === 'nobus' ? '#d32f2f' : status === 'error' ? '#f57c00' : '#388e3c';
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

// Track Bus (Passenger Mode)
const trackBusBtn = document.getElementById('trackBus');
if (trackBusBtn) {
    console.log('Track Bus button found and listener attached');
    trackBusBtn.addEventListener('click', () => {
        console.log('=== TRACK BUS CLICKED ===');
        console.log('Current route:', currentRoute);
        
        if (!map) {
            alert('Map not initialized. Please refresh the page.');
            return;
        }
        
        if (!currentRoute) {
            alert('No route selected!');
            return;
        }
        
        trackBusBtn.classList.add('hidden');
        document.getElementById('stopTracking').classList.remove('hidden');
        document.getElementById('etaInfo').classList.remove('hidden');
        
        showMessage('loading', currentRoute);
        
        console.log('UI updated, now loading buses...');
        
        loadActiveBuses();
        
        updateInterval = setInterval(loadActiveBuses, 2000);
        console.log('Update interval started');
    });
} else {
    console.error('ERROR: Track Bus button not found in DOM!');
}

// Stop Tracking
document.getElementById('stopTracking').addEventListener('click', () => {
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

// Load active buses for passenger
async function loadActiveBuses() {
    try {
        const url = `/api/active_buses/${currentRoute}`;
        console.log('Fetching active buses from:', url);
        
        const response = await fetch(url);
        const data = await response.json();
        
        console.log('Active buses response:', data);
        console.log('Number of buses:', data.buses ? data.buses.length : 0);
        
        if (data.buses && data.buses.length > 0) {
            console.log(`Found ${data.buses.length} active bus(es) on Route ${currentRoute}`);
            
            if (data.buses.length === 1) {
                showMessage('found', currentRoute);
            } else {
                showMessage('multiple', currentRoute);
            }
            
            const activeBusIds = [];
            
            data.buses.forEach(bus => {
                console.log('Processing bus:', {
                    id: bus.bus_id,
                    lat: bus.lat,
                    lng: bus.lng,
                    driver: bus.driver_name,
                    traffic: bus.traffic_level
                });
                
                activeBusIds.push(bus.bus_id);
                updateBusMarker(bus.bus_id, bus.lat, bus.lng, false, bus.driver_name);
            });
            
            Object.keys(busMarkers).forEach(busId => {
                if (!activeBusIds.includes(busId)) {
                    console.log('Removing inactive bus:', busId);
                    removeBusMarker(busId);
                }
            });
            
            updateClosestBusETA();
            
            console.log('Bus markers on map:', Object.keys(busMarkers));
        } else {
            console.log('No active buses found on Route:', currentRoute);
            showMessage('nobus', currentRoute);
            
            Object.keys(busMarkers).forEach(busId => {
                removeBusMarker(busId);
            });
            
            const etaMinutesEl = document.getElementById('etaMinutes');
            const distanceEl = document.getElementById('distance');
            const nearestStopEl = document.getElementById('nearestStop');
            
            if (etaMinutesEl) etaMinutesEl.textContent = '--';
            if (distanceEl) distanceEl.textContent = '-- km';
            if (nearestStopEl) nearestStopEl.textContent = 'No buses active';
        }
    } catch (error) {
        console.error('Error loading active buses:', error);
        showMessage('error', currentRoute);
    }
}

// Waiting Toggle
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
    console.log('Bus update received:', data.bus_id);
    
    updateBusMarker(data.bus_id, data.lat, data.lng, false);
    
    if (document.getElementById('trackBus').classList.contains('hidden')) {
        updateClosestBusETA();
    }
}

function handleAllBusesUpdate(data) {
    console.log('All buses update:', data);
    
    if (data.buses && data.buses.length > 0) {
        data.buses.forEach(bus => {
            updateBusMarker(bus.bus_id, bus.lat, bus.lng, false);
        });
        
        updateClosestBusETA();
    }
}

function handleBusRemoved(data) {
    console.log('Bus removed:', data.bus_id);
    removeBusMarker(data.bus_id);
    updateClosestBusETA();
}

function updateClosestBusETA() {
    console.log('=== updateClosestBusETA called ===');
    
    const etaMinutesEl = document.getElementById('etaMinutes');
    const distanceEl = document.getElementById('distance');
    const nearestStopEl = document.getElementById('nearestStop');
    const etaInfoDiv = document.getElementById('etaInfo');
    const etaDisplay = etaInfoDiv ? etaInfoDiv.querySelector('.eta-display') : null;
    
    console.log('ETA elements found:', {
        etaMinutes: !!etaMinutesEl,
        distance: !!distanceEl,
        nearestStop: !!nearestStopEl,
        etaDisplay: !!etaDisplay
    });
    
    const allBusIds = Object.keys(busMarkers);
    console.log('Active bus markers:', allBusIds.length, allBusIds);
    
    if (allBusIds.length === 0) {
        console.log('No buses to track');
        if (etaMinutesEl) etaMinutesEl.textContent = '--';
        if (distanceEl) distanceEl.textContent = '-- km';
        if (nearestStopEl) nearestStopEl.textContent = 'No buses active';
        if (etaDisplay) etaDisplay.style.display = 'none';
        return;
    }
    
    if (etaDisplay) {
        etaDisplay.style.display = 'grid';
    }
    
    const waitingStopSelect = document.getElementById('waitingStopSelect');
    const selectedStopId = parseInt(waitingStopSelect.value);
    const stops = window.stopsData[currentRoute];
    
    console.log('Stops data:', stops ? `${stops.length} stops` : 'null');
    console.log('Selected stop ID:', selectedStopId);
    
    let referenceStop = stops && stops.length > 0 ? stops[0] : null;
    
    if (selectedStopId && stops) {
        const userStop = stops.find(s => s.id === selectedStopId);
        if (userStop) {
            referenceStop = userStop;
            console.log('Using user-selected stop:', referenceStop.name);
        }
    }
    
    if (!referenceStop) {
        console.error('No reference stop found!');
        if (etaMinutesEl) etaMinutesEl.textContent = '--';
        if (distanceEl) distanceEl.textContent = '-- km';
        if (nearestStopEl) nearestStopEl.textContent = 'Stop data unavailable';
        if (etaDisplay) etaDisplay.style.display = 'none';
        return;
    }
    
    console.log('Using reference stop:', referenceStop.name, `(${referenceStop.lat}, ${referenceStop.lng})`);
    
    let closestBus = null;
    let minDistance = Infinity;
    
    allBusIds.forEach(busId => {
        const marker = busMarkers[busId];
        if (!marker) {
            console.log('Warning: marker not found for', busId);
            return;
        }
        
        const latlng = marker.getLatLng();
        const dist = calculateDistance(referenceStop.lat, referenceStop.lng, latlng.lat, latlng.lng);
        
        console.log(`Bus ${busId.substring(0, 8)}: ${dist.toFixed(2)} km from ${referenceStop.name}`);
        
        if (dist < minDistance) {
            minDistance = dist;
            closestBus = busId;
        }
    });
    
    if (closestBus && minDistance !== Infinity) {
        const trafficLevel = 1.5;
        const etaMinutes = predictETA(minDistance, trafficLevel);
        
        console.log(`✅ Closest bus: ${closestBus.substring(0, 8)}`);
        console.log(`✅ Distance: ${minDistance.toFixed(2)} km`);
        console.log(`✅ ETA: ${Math.round(etaMinutes)} minutes`);
        
        if (etaMinutesEl) {
            etaMinutesEl.textContent = Math.round(etaMinutes);
            console.log('✅ Updated etaMinutes to:', etaMinutesEl.textContent);
        }
        if (distanceEl) {
            distanceEl.textContent = `${minDistance.toFixed(2)} km`;
            console.log('✅ Updated distance to:', distanceEl.textContent);
        }
        if (nearestStopEl) {
            nearestStopEl.textContent = referenceStop.name;
            console.log('✅ Updated nearestStop to:', nearestStopEl.textContent);
        }
        
        if (etaDisplay) {
            etaDisplay.style.display = 'grid';
        }
    } else {
        console.log('Could not determine closest bus');
        if (etaMinutesEl) etaMinutesEl.textContent = '--';
        if (distanceEl) distanceEl.textContent = '-- km';
        if (nearestStopEl) nearestStopEl.textContent = 'Calculating...';
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
    console.log(`Active buses on route ${data.route_id}: ${data.count}`);
}

function handleWaitingUpdate(data) {
    console.log('Waiting update:', data);
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

console.log('=== Initializing Bus Tracking System ===');
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
    console.log('All elements loaded');
    console.log('Track Bus button exists:', !!document.getElementById('trackBus'));
    console.log('Passenger UI exists:', !!document.getElementById('passengerUI'));
    console.log('Map container exists:', !!document.getElementById('map'));
});
