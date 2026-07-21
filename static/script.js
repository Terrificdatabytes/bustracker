// Complete script.js with OSRM Waypoint-Based Distance Calculation
// Date: 2025-10-19 16:38:01 UTC
// Author: Terrificdatabytes 
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
let isBusFull = false;
let gpsManager = null;

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

// ============================================================
// GPS Data Manager
// ------------------------------------------------------------
// Collects GPS from MULTIPLE readings (an initial burst + a
// continuous watchPosition stream), VALIDATES each one (accuracy
// + impossible-jump filters), and emits ONE correct fix every
// SECOND to the server. The server computes the authoritative
// speed from those fixes and echoes it back via 'bus_info_update'
// every second → second-to-second speed for the driver.
// ============================================================
class GPSManager {
    constructor(options = {}) {
        // --- Tunable settings ---
        this.maxAcceptableAccuracy = options.maxAcceptableAccuracy ?? 50;    // reject readings worse than this (meters)
        this.minSamples            = options.minSamples ?? 3;                // good samples needed before first emit
        this.emitIntervalMs        = options.emitIntervalMs ?? 1000;         // ⚡ second-to-second emit rate
        this.maxJumpSpeedKmh       = options.maxJumpSpeedKmh ?? 180;         // reject physically impossible jumps
        this.minJumpDistanceKm     = options.minJumpDistanceKm ?? 0.03;      // ignore tiny jumps in speed check
        this.fallbackMs            = options.fallbackMs ?? 10000;            // emit best-available if no good fix by then

        // --- Internal state ---
        this.validSampleCount = 0;
        this.listeners        = [];
        this.lastEmitted      = null;     // last fix emitted (for jump check)
        this.lastEmitTime     = 0;
        this.startedAt        = Date.now();
        this.hasEmitted       = false;
        this.rejectedCount    = 0;
    }

    /** Register a callback that receives ONLY validated fixes. */
    onValidPosition(cb) {
        if (typeof cb === 'function') this.listeners.push(cb);
        return this;
    }

    /** Feed a raw geolocation reading in for validation + processing. */
    addReading(position) {
        if (!position || !position.coords) return false;

        const { latitude, longitude, accuracy, speed } = position.coords;
        const timestamp = position.timestamp || Date.now();
        const acc = (typeof accuracy === 'number') ? accuracy : 9999;

        // --- Filter 1: accuracy (reject jittery / weak fixes) ---
        if (acc > this.maxAcceptableAccuracy) {
            this.rejectedCount++;
            console.warn(`⚠ GPS rejected — low accuracy (${acc.toFixed(0)} m)`);
            return false;
        }

        // --- Filter 2: physically impossible jump (reject GPS "teleports") ---
        if (this.lastEmitted) {
            const dt = (timestamp - this.lastEmitted.timestamp) / 1000; // seconds
            const d  = this._distance(this.lastEmitted.lat, this.lastEmitted.lng, latitude, longitude); // km
            if (dt > 0 && d > this.minJumpDistanceKm) {
                const spd = (d / dt) * 3600;
                if (spd > this.maxJumpSpeedKmh) {
                    this.rejectedCount++;
                    console.warn(`⚠ GPS rejected — impossible jump (${spd.toFixed(0)} km/h, ${d.toFixed(3)} km)`);
                    return false;
                }
            }
        }

        // Validated fix = the "one correct data" we send to the server
        this.validSampleCount++;
        const fix = {
            lat: latitude,
            lng: longitude,
            accuracy: acc,
            timestamp,
            // Native device speed (m/s → km/h); null if the device didn't report it.
            // Sent to the server as an optional surge fallback.
            nativeSpeed: (typeof speed === 'number' && speed >= 0) ? speed * 3.6 : null
        };

        // --- Decide whether to emit now ---
        const now           = Date.now();
        const enoughSamples = this.validSampleCount >= this.minSamples;
        const fallbackReady = !this.hasEmitted && (now - this.startedAt) > this.fallbackMs;
        const throttleOk    = (now - this.lastEmitTime) >= this.emitIntervalMs;

        if (!(enoughSamples || fallbackReady)) {
            console.log(`⏳ Collecting GPS samples (${this.validSampleCount}/${this.minSamples})...`);
            return false;
        }
        if (!throttleOk) return false;

        this.lastEmitTime = now;
        this.hasEmitted   = true;
        this.lastEmitted  = { lat: fix.lat, lng: fix.lng, timestamp };

        this.listeners.forEach(cb => cb(fix));
        return true;
    }

    /** Quickly grab several samples up front to establish a good baseline. */
    collectBurst(count = 3, intervalMs = 700) {
        if (!navigator.geolocation) return;
        let collected = 0;
        const grab = () => {
            navigator.geolocation.getCurrentPosition(
                (pos) => { this.addReading(pos); next(); },
                (err) => { console.warn('GPS burst error:', err.message); next(); },
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        };
        const next = () => {
            collected++;
            if (collected < count) setTimeout(grab, intervalMs);
        };
        grab();
    }

    /** Haversine distance in km. */
    _distance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    reset() {
        this.validSampleCount = 0;
        this.lastEmitted = null;
        this.lastEmitTime = 0;
        this.startedAt = Date.now();
        this.hasEmitted = false;
        this.rejectedCount = 0;
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

// Capacity Toggle Element
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
    
    // Listen for capacity update confirmation
    socket.on('capacity_updated', (data) => {
        console.log('✓ Capacity updated:', data.message);
    });
    
    // Listen for reservation updates
    socket.on('reservation_update', (data) => {
        console.log('✓ Reservation update:', data);
        // Update available seats display
        animateValueChange('passengerAvailableSeats', data.available_seats, 'passengerSeatsCard');
        animateValueChange('driverAvailableSeats', data.available_seats, 'driverSeatsCard');
    });
    
    // Listen for reservation result
    socket.on('reservation_result', (data) => {
        const statusDiv = document.getElementById('reservationStatus');
        statusDiv.classList.remove('success', 'error');
        
        if (data.success) {
            statusDiv.classList.add('success');
            statusDiv.textContent = data.message;
        } else {
            if (data.waiting) {
                statusDiv.classList.add('error');
                statusDiv.textContent = data.message;
            } else {
                statusDiv.classList.add('error');
                statusDiv.textContent = data.message;
            }
        }
        
        // Clear status after 5 seconds
        setTimeout(() => {
            statusDiv.classList.remove('success', 'error');
            statusDiv.textContent = '';
        }, 5000);
    });
    
    // Listen for reservation assigned from waiting list
    socket.on('reservation_assigned', (data) => {
        console.log('✓ Reservation assigned from waiting list:', data);
        const statusDiv = document.getElementById('reservationStatus');
        statusDiv.classList.remove('error');
        statusDiv.classList.add('success');
        statusDiv.textContent = data.message;
        
        // Clear after 5 seconds
        setTimeout(() => {
            statusDiv.classList.remove('success');
            statusDiv.textContent = '';
        }, 5000);
    });
}

function handleDriverAuthentication(data) {
    if (data.success) {
        isAuthenticated = true;
        driverInfo.driver_id = data.driver.driver_id;
        driverInfo.name = data.driver.name;
        driverAuthModal.style.display = 'none';
        console.log('✓ Driver authenticated successfully');
        
        // Show bus ID input after authentication
        document.getElementById('busIdInput').classList.remove('hidden');
        document.getElementById('busIdField').focus();
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

// Update Driver Progress Bar Function
function updateProgressBar(data) {
    const progressContainer = document.getElementById('progressContainer');
    const progressBarFill = document.getElementById('progressBarFill');
    const progressText = document.getElementById('progressText');
    const progressDistance = document.getElementById('progressDistance');
    const progressStart = document.getElementById('progressStart');
    const progressEnd = document.getElementById('progressEnd');
    
    if (!progressContainer || !progressBarFill) return;
    
    console.log('🔵 Updating driver progress bar:', data);
    
    // Show progress bar when sharing location
    if (isSharing) {
        progressContainer.classList.remove('hidden');
    }
    
    // Update progress percentage (from server)
    const progress = Math.min(data.progress_pct || 0, 100);
    progressBarFill.style.width = `${progress}%`;
    progressText.textContent = `${Math.round(progress)}%`;
    
    // ✅ Update distance covered (FROM SERVER - waypoint-based)
    const distanceCovered = data.distance_from_start || 0;
    progressDistance.textContent = formatDistance(distanceCovered);
    
    console.log(`✅ Driver Progress: ${progress.toFixed(1)}%, Distance: ${distanceCovered.toFixed(2)} km (waypoint-based)`);
    
    // Update start/end stop names based on direction
    if (currentRoute && window.stopsData && window.stopsData[currentRoute]) {
        const stops = window.stopsData[currentRoute];
        if (data.direction === 'forward') {
            progressStart.textContent = stops[0]?.name || 'Start';
            progressEnd.textContent = stops[stops.length - 1]?.name || 'End';
        } else {
            progressStart.textContent = stops[stops.length - 1]?.name || 'End';
            progressEnd.textContent = stops[0]?.name || 'Start';
        }
    }
}

// Update Passenger Progress Bar Function
function updatePassengerProgressBar(busData) {
    const progressContainer = document.getElementById('passengerProgressContainer');
    const progressBarFill = document.getElementById('passengerProgressBarFill');
    const progressText = document.getElementById('passengerProgressText');
    const progressDistance = document.getElementById('passengerProgressDistance');
    const progressStart = document.getElementById('passengerProgressStart');
    const progressEnd = document.getElementById('passengerProgressEnd');
    
    if (!progressContainer || !progressBarFill) {
        console.warn('Passenger progress bar elements not found');
        return;
    }
    
    console.log('🔵 Updating passenger progress bar:', busData);
    
    // Show progress bar when tracking bus
    if (isTracking && busData) {
        progressContainer.classList.remove('hidden');
        
        // Update progress percentage (from server)
        const progress = Math.min(busData.progress_pct || 0, 100);
        progressBarFill.style.width = `${progress}%`;
        progressText.textContent = `${Math.round(progress)}%`;
        
        // ✅ Update distance covered (FROM SERVER - waypoint-based)
        const distanceCovered = busData.distance_from_start || 0;
        progressDistance.textContent = formatDistance(distanceCovered);
        
        console.log(`✅ Passenger Progress: ${progress.toFixed(1)}%, Distance: ${distanceCovered.toFixed(2)} km (waypoint-based)`);
        
        // Update start/end stop names based on direction
        if (currentRoute && window.stopsData && window.stopsData[currentRoute]) {
            const stops = window.stopsData[currentRoute];
            const direction = busData.direction || 'forward';
            
            if (direction === 'forward') {
                progressStart.textContent = stops[0]?.name || 'Start';
                progressEnd.textContent = stops[stops.length - 1]?.name || 'End';
            } else {
                progressStart.textContent = stops[stops.length - 1]?.name || 'End';
                progressEnd.textContent = stops[0]?.name || 'Start';
            }
        }
    } else {
        progressContainer.classList.add('hidden');
    }
}

function handleBusInfoUpdate(data) {
    console.log('📊 Bus info update received:', data);
    
    // ⚡ Speed is computed by the server from our 1-second position updates and
    // echoed back here every second — authoritative and identical to what
    // passengers see. (No local override, so it can't get stuck.)
    animateValueChange('busSpeed', data.speed, 'speedCard');
    animateValueChange('nearestStopDriver', data.nearest_stop, 'stopCard');
    animateValueChange('distanceToStop', formatDistance(data.distance_to_stop), 'distanceCard');
    animateValueChange('etaToStop', data.eta_to_stop, 'etaCard');
    
    // Update progress bar with distance covered
    updateProgressBar(data);
    
    // Display current stop if bus is at a stop
    const currentStopDisplay = document.getElementById('currentStopDisplay');
    const currentStopName = document.getElementById('currentStopName');
    
    if (data.current_stop) {
        currentStopDisplay.classList.remove('hidden');
        currentStopName.textContent = data.current_stop;
    } else {
        currentStopDisplay.classList.add('hidden');
    }
    
    // Show waiting passengers in driver UI
    updateWaitingPassengersDisplay(data.waiting_passengers);
}

function updateWaitingPassengersDisplay(waitingData) {
    const waitingList = document.getElementById('driverWaitingList');
    if (!waitingList) return;
    
    if (!waitingData || Object.keys(waitingData).length === 0) {
        waitingList.innerHTML = '<p style="text-align center; color: #999;">No passengers waiting currently</p>';
        return;
    }
    
    let html = '';
    Object.entries(waitingData).forEach(([stopId, count]) => {
        if (count > 0) {
            const stop = window.stopsData[currentRoute]?.find(s => s.id === parseInt(stopId));
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
        html = '<p style="text-align center; color: #999;">No passengers waiting currently</p>';
    }
    
    waitingList.innerHTML = html;
}

// Bus Capacity Toggle Handler
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
    console.log('DEBUG: Login button clicked');
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
    console.log('DEBUG: Emit sent to server');
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
        console.log('✓ Routes loaded:', data.routes);
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
    
    console.log('✓ Map initialized');
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
    
    console.log(`✓ Added ${stops.length} stop markers for route ${route}`);
}

document.getElementById('busMode').addEventListener('click', () => {
    currentMode = 'bus';
    console.log('✓ Bus mode selected');
    modeSelection.classList.add('hidden');
    routeSelection.classList.remove('hidden');
});

document.getElementById('passengerMode').addEventListener('click', () => {
    currentMode = 'passenger';
    console.log('✓ Passenger mode selected');
    modeSelection.classList.add('hidden');
    routeSelection.classList.remove('hidden');
});

document.getElementById('routeSelect').addEventListener('change', (e) => {
    currentRoute = e.target.value;
    
    if (!currentRoute) return;
    
    console.log(`✓ Route selected: ${currentRoute}`);
    
    if (currentMode === 'bus') {
        setupBusMode();
    } else {
        setupPassengerMode();
    }
});

function setupBusMode() {
    console.log('Setting up bus mode...');
    showDriverAuthModal();
    
    routeSelection.classList.add('hidden');
    busUI.classList.remove('hidden');
    mapContainer.classList.remove('hidden');
    
    document.getElementById('busRoute').textContent = currentRoute;
    document.getElementById('busIdRouteDisplay').textContent = currentRoute;
    
    const stops = window.stopsData[currentRoute];
    if (stops && stops.length > 0) {
        initMap(stops[0].lat, stops[0].lng);
        addStopMarkers(currentRoute);
    } else {
        initMap();
    }
    
    loadWaitingStats();
    
    console.log('✓ Bus mode setup complete');
}

function setupPassengerMode() {
    console.log('Setting up passenger mode...');
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
    
    // Make reserve seat button visible in passenger mode
    document.getElementById('reserveBtn').classList.remove('hidden');
    
    console.log('✓ Passenger mode setup complete');
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
    
    console.log('🚀 Starting location sharing...');
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
    
    // Initialize GPS Manager: collects MULTIPLE readings, validates them, and
    // emits ONE correct fix every SECOND → the server computes second-to-second
    // speed and echoes it back via 'bus_info_update'.
    gpsManager = new GPSManager({
        maxAcceptableAccuracy: 50,   // ignore readings worse than 50 m
        minSamples: 3,               // 3 good samples before first emit
        emitIntervalMs: 1000         // ⚡ SECOND-TO-SECOND updates
    });

    gpsManager.onValidPosition((fix) => {
        const trafficLevel = parseFloat(document.getElementById('trafficLevel').value);

        console.log(`✅ GPS → server: ${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)} | ${fix.nativeSpeed !== null ? fix.nativeSpeed.toFixed(1) + ' km/h native' : 'no native speed'} (±${fix.accuracy.toFixed(0)} m)`);

        // Send the validated fix every second. The server computes the
        // authoritative speed from the position history and sends it back in
        // 'bus_info_update' (second-to-second). Native device speed is included
        // as an optional surge fallback (null if the device doesn't report it).
        socket.emit('bus_location', {
            route_id: currentRoute,
            bus_id: myBusId,
            lat: fix.lat,
            lng: fix.lng,
            speed: fix.nativeSpeed,       // native speed (km/h) or null — server uses it only during GPS surges
            traffic_level: trafficLevel
        });

        updateBusMarker(myBusId, fix.lat, fix.lng, true);
    });

    console.log('🛰 Collecting initial GPS burst (multiple samples)...');
    gpsManager.collectBurst(3, 700); // gather multiple samples up front

    // Continuous stream of readings feeds the same manager
    trackingInterval = navigator.geolocation.watchPosition(
        (position) => gpsManager.addReading(position),
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
    console.log('⏹ Stopping location sharing...');
    isSharing = false;
    
    if (trackingInterval) {
        navigator.geolocation.clearWatch(trackingInterval);
        trackingInterval = null;
    }

    if (gpsManager) {
        gpsManager.reset();
        gpsManager = null;
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
    document.getElementById('progressContainer').classList.add('hidden');
    
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
        
        console.log(`✓ Bus marker added: ${busId} at ${lat}, ${lng}`);
        
        if (Object.keys(busMarkers).length === 1) {
            map.setView([lat, lng], 14);
        }
    }
}

function removeBusMarker(busId) {
    if (busMarkers[busId]) {
        map.removeLayer(busMarkers[busId]);
        delete busMarkers[busId];
        console.log(`✓ Bus marker removed: ${busId}`);
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
        
        console.log('✓ Bus tracking started, updating every 2 seconds');
    });
}

document.getElementById('stopTracking').addEventListener('click', () => {
    console.log('⏹ Stopping bus tracking...');
    isTracking = false;
    document.getElementById('stopTracking').classList.add('hidden');
    document.getElementById('trackBus').classList.remove('hidden');
    document.getElementById('etaInfo').classList.add('hidden');
    document.getElementById('recenterMap').style.display = 'none';
    document.getElementById('passengerCurrentStopDisplay').classList.add('hidden');
    document.getElementById('passengerProgressContainer').classList.add('hidden');
    
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
    
    console.log('✓ Bus tracking stopped');
});

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
        console.log(`📡 Fetching active buses from: ${url}`);
        const response = await fetch(url);
        const data = await response.json();
        
        console.log('📦 Active buses data:', data);
        
        if (data.buses && data.buses.length > 0) {
            console.log(`✓ Found ${data.buses.length} active bus(es)`);
            
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
            console.warn('⚠ No active buses found');
            showMessage('nobus', currentRoute);
            
            Object.keys(busMarkers).forEach(busId => {
                removeBusMarker(busId);
            });
            
            animateValueChange('etaMinutes', '--', 'passengerEtaCard');
            animateValueChange('distance', '--', 'passengerDistanceCard');
            animateValueChange('busLocationStop', 'No buses active', 'passengerStopCard');
            animateValueChange('busSpeedPassenger', '--', 'passengerSpeedCard');
            
            document.getElementById('passengerCurrentStopDisplay').classList.add('hidden');
            document.getElementById('passengerProgressContainer').classList.add('hidden');
        }
    } catch (error) {
        console.error('❌ Error loading active buses:', error);
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
        console.log(`✓ Waiting at stop ${stopId}`);
    } else {
        this.textContent = "I'm Waiting at This Stop";
        this.classList.remove('btn-danger');
        this.classList.add('btn-info');
        currentWaitingStop = null;
        console.log('✓ Cancelled waiting');
    }
});

function handleBusUpdate(data) {
    console.log('🚌 Bus update:', data);
    const direction = data.direction || 'forward';
    updateBusMarker(data.bus_id, data.lat, data.lng, false, data.driver_name, direction);
    
    if (isTracking) {
        updateClosestBusETA();
    }
}

function handleAllBusesUpdate(data) {
    console.log('🚍 All buses update:', data);
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
    console.log('🗑 Bus removed:', data);
    removeBusMarker(data.bus_id);
    
    if (data.reason === 'full' && currentMode === 'passenger') {
        console.log('ℹ️ Bus marked as full and hidden from view');
    }
    
    if (isTracking) {
        updateClosestBusETA();
    }
}

function updateClosestBusETA() {
    const allBusIds = Object.keys(busMarkers);
    
    console.log(`📊 Updating ETA for ${allBusIds.length} bus(es)`);
    
    if (allBusIds.length === 0) {
        animateValueChange('etaMinutes', '--', 'passengerEtaCard');
        animateValueChange('distance', '--', 'passengerDistanceCard');
        animateValueChange('busLocationStop', 'No buses active', 'passengerStopCard');
        animateValueChange('busSpeedPassenger', '--', 'passengerSpeedCard');
        document.getElementById('passengerCurrentStopDisplay').classList.add('hidden');
        document.getElementById('passengerProgressContainer').classList.add('hidden');
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
            console.log(`✓ User selected stop: ${userStop.name} (ID: ${selectedStopId})`);
        }
    }
    
    if (!referenceStop) {
        animateValueChange('etaMinutes', '--', 'passengerEtaCard');
        animateValueChange('distance', '--', 'passengerDistanceCard');
        animateValueChange('busLocationStop', 'Stop data unavailable', 'passengerStopCard');
        animateValueChange('busSpeedPassenger', '--', 'passengerSpeedCard');
        return;
    }
    
    // Find closest bus using simple haversine (just for selection)
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
        console.log(`✓ Closest bus: ${closestBus}`);
        
        // ✅ Fetch bus data first
        fetch(`/api/active_buses/${currentRoute}`)
            .then(res => res.json())
            .then(data => {
                const busData = data.buses.find(b => b.bus_id === closestBus);
                if (busData) {
                    console.log('✓ Bus data received:', busData);
                    
                    // ✅ If user has selected a stop, get accurate waypoint-based distance
                    if (selectedStopId) {
                        fetch(`/api/passenger_distance/${currentRoute}/${closestBus}/${selectedStopId}`)
                            .then(res => res.json())
                            .then(distanceData => {
                                console.log('✅ Waypoint-based distance data:', distanceData);
                                
                                const accurateDistance = distanceData.distance_to_stop_km;
                                const trafficLevel = 1.5;
                                const etaMinutes = predictETA(accurateDistance, trafficLevel);
                                
                                console.log(`📏 Accurate distance to stop: ${accurateDistance.toFixed(2)} km (waypoint-based)`);
                                
                                // Update UI with ACCURATE waypoint-based distance
                                animateValueChange('etaMinutes', Math.round(etaMinutes), 'passengerEtaCard');
                                animateValueChange('distance', formatDistance(accurateDistance), 'passengerDistanceCard');
                                animateValueChange('busSpeedPassenger', `${busData.speed} km/h`, 'passengerSpeedCard');
                                animateValueChange('busLocationStop', busData.next_stop || busData.nearest_stop || 'En route', 'passengerStopCard');
                                
                                // Display current stop if bus is at a stop
                                const passengerCurrentStopDisplay = document.getElementById('passengerCurrentStopDisplay');
                                const passengerCurrentStopName = document.getElementById('passengerCurrentStopName');
                                
                                if (busData.current_stop) {
                                    passengerCurrentStopDisplay.classList.remove('hidden');
                                    passengerCurrentStopName.textContent = busData.current_stop;
                                } else {
                                    passengerCurrentStopDisplay.classList.add('hidden');
                                }
                                
                                // Update passenger progress bar
                                updatePassengerProgressBar(busData);
                            })
                            .catch(error => {
                                console.error('❌ Error fetching passenger distance:', error);
                                // Fallback to haversine
                                const trafficLevel = 1.5;
                                const etaMinutes = predictETA(minDistance, trafficLevel);
                                
                                animateValueChange('etaMinutes', Math.round(etaMinutes), 'passengerEtaCard');
                                animateValueChange('distance', formatDistance(minDistance) + ' (approx)', 'passengerDistanceCard');
                                animateValueChange('busSpeedPassenger', `${busData.speed} km/h`, 'passengerSpeedCard');
                                animateValueChange('busLocationStop', busData.next_stop || busData.nearest_stop || 'En route', 'passengerStopCard');
                                updatePassengerProgressBar(busData);
                            });
                    } else {
                        // No stop selected, use haversine as fallback
                        const trafficLevel = 1.5;
                        const etaMinutes = predictETA(minDistance, trafficLevel);
                        
                        animateValueChange('etaMinutes', Math.round(etaMinutes), 'passengerEtaCard');
                        animateValueChange('distance', formatDistance(minDistance), 'passengerDistanceCard');
                        animateValueChange('busSpeedPassenger', `${busData.speed} km/h`, 'passengerSpeedCard');
                        animateValueChange('busLocationStop', busData.next_stop || busData.nearest_stop || 'En route', 'passengerStopCard');
                        updatePassengerProgressBar(busData);
                    }
                }
            })
            .catch(error => {
                console.error('❌ Error fetching bus data:', error);
            });
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
    console.log('📊 Bus count update:', data);
    animateInfoValue('busCount', data.count);
}

function handleWaitingUpdate(data) {
    console.log('👥 Waiting update:', data);
    loadWaitingStats();
}

function handleWaitingStats(data) {
    console.log('📊 Waiting stats:', data);
    updateWaitingDisplay(data);
    // Also update driver waiting list
    updateWaitingPassengersDisplay(data);
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
    const waitingList = currentMode === 'bus' ? document.getElementById('driverWaitingList') : document.getElementById('waitingList');
    
    if (!stats || !stats[currentRoute]) {
        waitingList.innerHTML = '<p style="text-align center; color: #999;">No one waiting currently</p>';
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
        html = '<p style="text-align center; color: #999;">No one waiting currently</p>';
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


console.log('=== Initializing Enhanced Bus Tracking System with OSRM Waypoints ===');
console.log('✓ Current stop detection enabled');
console.log('✓ Bus capacity management enabled');
console.log('✓ Full buses hidden from passenger view');
console.log('✓ Next stop display for passengers');
console.log('✓ Distance progress bar for Driver & Passenger modes');
console.log('✓ OSRM waypoint-based distance (99% accuracy)');
console.log('✓ TradingView-style animations enabled');
console.log('✓ Server-driven second-to-second speed (1 Hz position updates)');
console.log('Script loaded at:', new Date().toLocaleTimeString());

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('✓ DOM Content Loaded');
        initSocket();
        loadRoutes();
    });
} else {
    console.log('✓ DOM already loaded');
    initSocket();
    loadRoutes();
}

window.addEventListener('load', () => {
    console.log('=== Page Fully Loaded ===');
    console.log('✓ All elements loaded');
    console.log('✓ Track Bus button exists:', !!document.getElementById('trackBus'));
    console.log('✓ Passenger UI exists:', !!document.getElementById('passengerUI'));
    console.log('✓ Driver Stats exists:', !!document.getElementById('driverStats'));
    console.log('✓ Map container exists:', !!document.getElementById('map'));
    console.log('✓ Progress containers exist:', {
        driver: !!document.getElementById('progressContainer'),
        passenger: !!document.getElementById('passengerProgressContainer')
    });
});
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
    
    // Cancel waiting status for passengers
    if (isWaiting && currentWaitingStop && currentRoute) {
        socket.emit('passenger_waiting', {
            route_id: currentRoute,
            stop_id: currentWaitingStop,
            is_waiting: false
        });
        console.log('✓ Cancelled waiting status due to page unload');
    }
    
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    
    releaseWakeLock();
});

// Reserve Seat Button Logic
document.getElementById('reserveBtn').addEventListener('click', () => {
    if (!currentRoute) {
        alert('No route selected.');
        return;
    }
    
    const selectedStopId = parseInt(document.getElementById('waitingStopSelect').value);
    if (!selectedStopId) {
        alert('Please select a stop first.');
        return;
    }
    
    const passengerName = document.getElementById('passengerNameInput').value.trim() || 'Anonymous';
    
    // Generate session ID for this reservation
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Show loading state
    const reserveBtn = document.getElementById('reserveBtn');
    const originalText = reserveBtn.textContent;
    reserveBtn.textContent = 'Reserving...';
    reserveBtn.disabled = true;
    
    // Send reservation request to server
    fetch('/api/reserve_seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            route_id: currentRoute,
            passenger_name: passengerName,
            preferred_bus_id: null, // Let system auto-assign
            session_id: sessionId
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('✅ Reservation successful:', data);
            showTicket(data.bus_id, passengerName, currentRoute);
        } else {
            console.log('❌ Reservation failed:', data.message);
        }
    })
    .catch(error => {
        console.error('❌ Reservation error:', error);
        alert('Failed to reserve seat. Please try again.');
    })
    .finally(() => {
        // Reset button state
        reserveBtn.textContent = originalText;
        reserveBtn.disabled = false;
    });
});

// Function to show printable ticket
// Function to show printable ticket
function showTicket(busId, passengerName, routeId) {
    const ticketHtml = `
        <div style="padding: 5px; background: white; border: 1px solid #4CAF50; border-radius: 5px; max-width: 250px; margin: 0 auto; font-family: monospace; font-size: 12px; text-align: center;">
            <h2 style="color: #4CAF50; margin-bottom: 10px; font-size: 16px;">🚌 Bus Ticket</h2>
            <hr style="border: 0; border-top: 1px dashed #4CAF50; margin: 5px 0;">
            <p style="margin: 3px 0;"><strong>Passenger:</strong> ${passengerName}</p>
            <p style="margin: 3px 0;"><strong>Bus Name:</strong> Bus ${busId}</p>
            <p style="margin: 3px 0;"><strong>Route:</strong> ${routeId}</p>
            <p style="margin: 3px 0;"><strong>Reserved At:</strong> ${new Date().toLocaleString()}</p>
            <hr style="border: 0; border-top: 1px dashed #4CAF50; margin: 5px 0;">
            <p style="font-size: 10px; color: #666; margin: 5px 0;">Please show this ticket to the bus driver upon boarding.</p>
            <button onclick="window.print()" style="background: #4CAF50; color: white; border: none; padding: 5px; border-radius: 3px; cursor: pointer; width: 100%; margin-top: 5px; font-size: 12px;">Print Ticket</button>
        </div>
    `;
    
    // Show ticket on page for all devices
    document.getElementById('reservationStatus').innerHTML = ticketHtml;
    
    // Hide reservation UI
    document.getElementById('reserveBtn').style.display = 'none';
    document.getElementById('passengerNameInput').style.display = 'none';
    
    // Add print styles if not already added
    if (!document.getElementById('print-styles')) {
        const style = document.createElement('style');
        style.id = 'print-styles';
        style.textContent = `
            @media print {
                @page {
                    margin: 0.5cm;
                    size: A4;
                }
                body {
                    margin: 0;
                    padding: 0;
                }
                body * {
                    display: none;
                }
                #reservationStatus, #reservationStatus * {
                    display: block;
                }
                #reservationStatus {
                    position: static;
                    width: 100%;
                    height: auto;
                    margin: 0;
                    padding: 10px;
                    background: white;
                }
                #reservationStatus > div {
                    max-width: 250px;
                    margin: 0 auto;
                }
                #reservationStatus button {
                    display: none;
                }
            }
        `;
        document.head.appendChild(style);
    }
}
// Confirm Bus ID button
const confirmBusIdBtn = document.getElementById('confirmBusId');
if (confirmBusIdBtn) {
    confirmBusIdBtn.addEventListener('click', () => {
        const busId = document.getElementById('busIdField')?.value.trim();
        
        if (!busId) {
            alert('Please enter a valid bus ID');
            return;
        }
        
        // Validate bus ID format (optional, can be customized)
        if (!busId.match(/^[A-Z0-9]{3,10}$/i)) {
            alert('Bus ID should be 3-10 alphanumeric characters (e.g., BUS001)');
            return;
        }
        
        myBusId = busId;
        document.getElementById('busId').textContent = myBusId;
        document.getElementById('busIdInput').classList.add('hidden');
        
        // Now join the route with the provided bus ID
        socket.emit('join_route', { route_id: currentRoute, mode: 'bus', bus_id: myBusId });
        
        console.log(`✓ Bus ID confirmed: ${myBusId}`);
    });
}

// Handle Enter key in bus ID field
const busIdField = document.getElementById('busIdField');
if (busIdField) {
    busIdField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            confirmBusIdBtn?.click();
        }
    });
}
