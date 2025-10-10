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
        
        // Re-authenticate if we have driver info
        if (driverInfo && currentMode === 'bus') {
            socket.emit('driver_authenticate', {
                driver_id: driverInfo.driver_id,
                password: driverInfo.password
            });
        }
        
        // Rejoin route if we were on one
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

// Handle driver authentication response
function handleDriverAuthentication(data) {
    if (data.success) {
        isAuthenticated = true;
        driverInfo.driver_id = data.driver.driver_id;
        driverInfo.name = data.driver.name;
        driverAuthModal.style.display = 'none';
        console.log('Driver authenticated successfully');
        
        // Now join the route
        if (currentRoute) {
            socket.emit('join_route', { route_id: currentRoute, mode: 'bus' });
        }
    } else {
        alert(data.message || 'Authentication failed');
        isAuthenticated = false;
    }
}

// Handle authentication required
function handleAuthenticationRequired(data) {
    alert(data.message);
    showDriverAuthModal();
}

// Show driver authentication modal
function showDriverAuthModal() {
    driverAuthModal.style.display = 'flex';
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
}

// Driver Login
document.getElementById('loginBtn').addEventListener('click', async () => {
    const driverId = document.getElementById('loginDriverId').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!driverId || !password) {
        alert('Please enter Driver ID and Password');
        return;
    }
    
    // Store credentials for reconnection
    driverInfo = { driver_id: driverId, password: password };
    
    // Authenticate via socket
    socket.emit('driver_authenticate', {
        driver_id: driverId,
        password: password
    });
});

// Allow Enter key for login
document.getElementById('loginPassword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('loginBtn').click();
    }
});

// Driver Registration
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

// Toggle between login and register forms
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

// Load available routes
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

// Initialize OpenStreetMap
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

// Add stop markers to map
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

// Mode Selection
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

// Route Selection
document.getElementById('routeSelect').addEventListener('change', (e) => {
    currentRoute = e.target.value;
    
    if (!currentRoute) return;
    
    if (currentMode === 'bus') {
        setupBusMode();
    } else {
        setupPassengerMode();
    }
});

// Setup Bus Mode
function setupBusMode() {
    // Show authentication modal first
    showDriverAuthModal();
    
    routeSelection.classList.add('hidden');
    busUI.classList.remove('hidden');
    mapContainer.classList.remove('hidden');
    
    document.getElementById('busRoute').textContent = currentRoute;
    
    // Initialize map centered on first stop
    const stops = window.stopsData[currentRoute];
    if (stops && stops.length > 0) {
        initMap(stops[0].lat, stops[0].lng);
        addStopMarkers(currentRoute);
    } else {
        initMap();
    }
}

// Setup Passenger Mode
function setupPassengerMode() {
    routeSelection.classList.add('hidden');
    passengerUI.classList.remove('hidden');
    mapContainer.classList.remove('hidden');
    
    document.getElementById('passengerRoute').textContent = currentRoute;
    
    // Populate waiting stop select
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
    
    // Initialize map
    if (stops && stops.length > 0) {
        initMap(stops[0].lat, stops[0].lng);
        addStopMarkers(currentRoute);
    } else {
        initMap();
    }
    
    socket.emit('join_route', { route_id: currentRoute, mode: 'passenger' });
    
    // Load initial waiting stats
    loadWaitingStats();
}

// Traffic level slider
document.getElementById('trafficLevel').addEventListener('input', (e) => {
    document.getElementById('trafficValue').textContent = parseFloat(e.target.value).toFixed(1);
});

// Start Sharing Location (Bus Mode)
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
    
    // Share immediately
    shareLocation();
    
    // Then share every 1 second for real-time updates
    trackingInterval = setInterval(shareLocation, 1000);
});

// Stop Sharing Location
document.getElementById('stopSharing').addEventListener('click', () => {
    isSharing = false;
    clearInterval(trackingInterval);
    
    // Remove bus from active buses on server
    socket.emit('leave_route', { 
        route_id: currentRoute, 
        mode: 'bus',
        bus_id: myBusId 
    });
    
    document.getElementById('stopSharing').classList.add('hidden');
    document.getElementById('startSharing').classList.remove('hidden');
    document.getElementById('busStatus').textContent = 'Stopped';
    document.getElementById('busStatus').style.color = '#666';
    
    // Remove own bus marker from map
    if (busMarkers[myBusId]) {
        map.removeLayer(busMarkers[myBusId]);
        delete busMarkers[myBusId];
    }
});

// Share location function
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
            
            // Update own bus marker on map
            updateBusMarker(myBusId, latitude, longitude, true);
            
            // Center map on bus location
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

// Update or create bus marker
function updateBusMarker(busId, lat, lng, isOwnBus = false) {
    const color = isOwnBus ? '#4CAF50' : '#FF9800';
    const label = isOwnBus ? '🚌' : '🚍';
    
    if (busMarkers[busId]) {
        // Update existing marker position smoothly
        busMarkers[busId].setLatLng([lat, lng]);
    } else {
        // Create new marker
        busMarkers[busId] = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'bus-marker',
                html: `<div style="background: ${color}; color: white; padding: 8px; border-radius: 50%; font-size: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${label}</div>`,
                iconSize: [40, 40]
            })
        }).addTo(map);
        
        busMarkers[busId].bindPopup(`
            <div class="custom-popup">
                <h4>${label} Bus ${busId.substring(0, 4)}</h4>
                <p>${isOwnBus ? 'Your Bus' : 'Active Bus'}</p>
            </div>
        `);
    }
}

// Remove bus marker
function removeBusMarker(busId) {
    if (busMarkers[busId]) {
        map.removeLayer(busMarkers[busId]);
        delete busMarkers[busId];
        console.log(`Removed bus marker for ${busId}`);
    }
}

// Track Bus (Passenger Mode)
document.getElementById('trackBus').addEventListener('click', () => {
    document.getElementById('trackBus').classList.add('hidden');
    document.getElementById('stopTracking').classList.remove('hidden');
    document.getElementById('etaInfo').classList.remove('hidden');
    
    // Load all active buses immediately
    loadActiveBuses();
});

// Stop Tracking
document.getElementById('stopTracking').addEventListener('click', () => {
    document.getElementById('stopTracking').classList.add('hidden');
    document.getElementById('trackBus').classList.remove('hidden');
    document.getElementById('etaInfo').classList.add('hidden');
    
    // Remove all bus markers
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
        const response = await fetch(`/api/active_buses/${currentRoute}`);
        const data = await response.json();
        
        data.buses.forEach(bus => {
            updateBusMarker(bus.bus_id, bus.lat, bus.lng, false);
        });
    } catch (error) {
        console.error('Error loading active buses:', error);
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

// Handle single bus update (real-time)
function handleBusUpdate(data) {
    console.log('Bus update received:', data.bus_id);
    
    // Update bus marker on map
    updateBusMarker(data.bus_id, data.lat, data.lng, false);
    
    // Update ETA display if tracking
    if (document.getElementById('trackBus').classList.contains('hidden')) {
        // We are tracking
        updateClosestBusETA();
    }
}

// Handle all buses update (initial load for passengers)
function handleAllBusesUpdate(data) {
    console.log('All buses update:', data);
    
    if (data.buses && data.buses.length > 0) {
        data.buses.forEach(bus => {
            updateBusMarker(bus.bus_id, bus.lat, bus.lng, false);
        });
        
        updateClosestBusETA();
    }
}

// Handle bus removed event
function handleBusRemoved(data) {
    console.log('Bus removed:', data.bus_id);
    removeBusMarker(data.bus_id);
    updateClosestBusETA();
}

// Update ETA display with closest bus
function updateClosestBusETA() {
    const allBusElements = Object.keys(busMarkers);
    
    if (allBusElements.length === 0) {
        document.getElementById('etaMinutes').textContent = '--';
        document.getElementById('distance').textContent = '-- km';
        document.getElementById('nearestStop').textContent = 'No buses active';
        return;
    }
    
    // Find closest bus
    let closestBus = null;
    let minDistance = Infinity;
    
    Object.keys(busMarkers).forEach(busId => {
        const marker = busMarkers[busId];
        const latlng = marker.getLatLng();
        
        // Calculate distance to first stop
        const stops = window.stopsData[currentRoute];
        if (stops && stops.length > 0) {
            const dist = calculateDistance(stops[0].lat, stops[0].lng, latlng.lat, latlng.lng);
            if (dist < minDistance) {
                minDistance = dist;
                closestBus = busId;
            }
        }
    });
    
    if (closestBus) {
        // Calculate ETA for closest bus
        const trafficLevel = 1; // Default traffic level
        const etaMinutes = predictETA(minDistance, trafficLevel);
        
        document.getElementById('etaMinutes').textContent = Math.round(etaMinutes);
        document.getElementById('distance').textContent = `${minDistance.toFixed(2)} km`;
        
        const stops = window.stopsData[currentRoute];
        if (stops && stops.length > 0) {
            document.getElementById('nearestStop').textContent = stops[0].name;
        }
    }
}

// Simple ETA prediction (client-side)
function predictETA(distanceKm, trafficLevel) {
    const baseSpeed = 30; // km/h
    const speed = baseSpeed / trafficLevel;
    return (distanceKm / speed) * 60; // minutes
}

// Handle bus count updates
function handleBusCountUpdate(data) {
    const busCountEl = document.getElementById('busCount');
    if (busCountEl) {
        busCountEl.textContent = data.count;
    }
    console.log(`Active buses on route ${data.route_id}: ${data.count}`);
}

// Handle waiting updates
function handleWaitingUpdate(data) {
    console.log('Waiting update:', data);
    loadWaitingStats();
}

// Handle waiting statistics
function handleWaitingStats(data) {
    updateWaitingDisplay(data);
}

// Load waiting statistics
async function loadWaitingStats() {
    try {
        const response = await fetch('/api/waiting_stats');
        const data = await response.json();
        updateWaitingDisplay(data);
    } catch (error) {
        console.error('Error loading waiting stats:', error);
    }
}

// Update waiting display
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

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
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

// Cleanup on page unload
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
});

// Initialize app
console.log('Initializing Bus Tracking System...');
initSocket();
loadRoutes();