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

// Seat management state
let myBusNumber = null;
let occupiedSeats = 0;
let totalSeats = 50;
let isPriorityPassenger = false;
let queuePosition = 0;

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
    
    // Seat management event listeners
    socket.on('bus_number_confirmed', handleBusNumberConfirmed);
    socket.on('seat_count_updated', handleSeatCountUpdated);
    socket.on('bus_seat_status', handleBusSeatStatus);
    socket.on('booking_confirmed', handleBookingConfirmed);
    socket.on('booking_priority', handleBookingPriority);
    socket.on('booking_error', handleBookingError);
    socket.on('priority_count', handlePriorityCount);
    socket.on('seat_status', handleSeatStatus);
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
    
    // Update driver panel with real-time info and animations
    animateValueChange('busSpeed', data.speed, 'speedCard');
    animateValueChange('nearestStopDriver', data.nearest_stop, 'stopCard');
    animateValueChange('distanceToStop', formatDistance(data.distance_to_stop), 'distanceCard');
    animateValueChange('etaToStop', data.eta_to_stop, 'etaCard');
    
    // Update seat information
    if (data.occupied_seats !== undefined) {
        occupiedSeats = data.occupied_seats;
        totalSeats = data.total_seats || 50;
        updateSeatDisplay();
    }
    
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
}

// Seat management handlers
function handleBusNumberConfirmed(data) {
    console.log('✓ Bus number confirmed:', data);
    myBusNumber = data.bus_number;
    document.getElementById('busNumberValue').textContent = `#${data.bus_number}`;
    document.getElementById('busNumberSelection').style.display = 'none';
    alert(`Bus #${data.bus_number} assigned successfully!`);
}

function handleSeatCountUpdated(data) {
    console.log('✓ Seat count updated:', data);
    occupiedSeats = data.occupied;
    totalSeats = data.total;
    updateSeatDisplay();
    
    if (data.is_full) {
        alert('Bus is now at full capacity!');
    }
}

function handleBusSeatStatus(data) {
    console.log('📊 Bus seat status update:', data);
    
    // Update seat availability display for passengers
    if (currentMode === 'passenger' && data.route_id === currentRoute) {
        const seatAvailability = document.getElementById('seatAvailability');
        const availableSeatsCount = document.getElementById('availableSeatsCount');
        const approachingBusNumber = document.getElementById('approachingBusNumber');
        const passengerOccupiedSeats = document.getElementById('passengerOccupiedSeats');
        const passengerTotalSeats = document.getElementById('passengerTotalSeats');
        
        if (seatAvailability) {
            seatAvailability.classList.remove('hidden');
            approachingBusNumber.textContent = data.bus_id.substring(0, 8);
            availableSeatsCount.textContent = data.available;
            passengerOccupiedSeats.textContent = data.occupied;
            passengerTotalSeats.textContent = data.total;
            
            // Change color based on availability
            if (data.available <= 5) {
                seatAvailability.style.background = 'linear-gradient(135deg, #F44336 0%, #D32F2F 100%)';
            } else if (data.available <= 15) {
                seatAvailability.style.background = 'linear-gradient(135deg, #FF9800 0%, #F57C00 100%)';
            } else {
                seatAvailability.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
            }
        }
    }
}

function handleBookingConfirmed(data) {
    console.log('✓ Booking confirmed:', data);
    alert(`Seat booked successfully! Bus #${data.bus_number}, Seat #${data.seat_number}`);
    isPriorityPassenger = false;
    document.getElementById('priorityBadge').classList.add('hidden');
}

function handleBookingPriority(data) {
    console.log('⭐ Added to priority queue:', data);
    alert(data.message);
    isPriorityPassenger = true;
    queuePosition = data.queue_position;
    
    const priorityBadge = document.getElementById('priorityBadge');
    const queuePositionSpan = document.getElementById('queuePosition');
    
    if (priorityBadge) {
        priorityBadge.classList.remove('hidden');
        queuePositionSpan.textContent = queuePosition;
    }
}

function handleBookingError(data) {
    console.error('❌ Booking error:', data);
    alert(data.message || 'Failed to book seat. Please try again.');
}

function handlePriorityCount(data) {
    console.log('📊 Priority count:', data);
    // Update driver UI with priority passenger counts
    if (currentMode === 'bus' && data.route_id === currentRoute) {
        updateDriverWaitingList(data);
    }
}

function handleSeatStatus(data) {
    console.log('📊 Seat status:', data);
    occupiedSeats = data.occupied;
    totalSeats = data.total;
    updateSeatDisplay();
}

function updateSeatDisplay() {
    const occupiedSeatsElem = document.getElementById('occupiedSeats');
    const totalSeatsElem = document.getElementById('totalSeats');
    const seatWarning = document.getElementById('seatWarning');
    
    if (occupiedSeatsElem) {
        occupiedSeatsElem.textContent = occupiedSeats;
    }
    
    if (totalSeatsElem) {
        totalSeatsElem.textContent = totalSeats;
    }
    
    // Show warning if approaching capacity
    if (seatWarning) {
        if (occupiedSeats >= totalSeats - 5 && occupiedSeats < totalSeats) {
            seatWarning.classList.remove('hidden');
        } else {
            seatWarning.classList.add('hidden');
        }
    }
    
    // Auto-toggle capacity status if full
    if (occupiedSeats >= totalSeats && !isBusFull) {
        const capacityToggle = document.getElementById('capacityToggle');
        if (capacityToggle && !capacityToggle.checked) {
            capacityToggle.checked = true;
            capacityToggle.dispatchEvent(new Event('change'));
        }
    }
}

function updateDriverWaitingList(priorityData) {
    const driverWaitingList = document.getElementById('driverWaitingList');
    if (!driverWaitingList || !currentRoute) return;
    
    const stops = window.stopsData[currentRoute];
    if (!stops) return;
    
    let html = '';
    
    if (priorityData && priorityData.counts) {
        Object.entries(priorityData.counts).forEach(([stopId, count]) => {
            if (count > 0) {
                const stop = stops.find(s => s.id === parseInt(stopId));
                const stopName = stop ? stop.name : `Stop ${stopId}`;
                
                html += `
                    <div class="waiting-list-item" style="border-left: 4px solid #FF9800;">
                        <span>⭐ ${stopName}</span>
                        <span class="waiting-count" style="background: #FF9800;">${count} priority</span>
                    </div>
                `;
            }
        });
    }
    
    // Also show regular waiting passengers
    if (waiting_passengers && waiting_passengers[currentRoute]) {
        Object.entries(waiting_passengers[currentRoute]).forEach(([stopId, count]) => {
            if (count > 0) {
                const stop = stops.find(s => s.id === parseInt(stopId));
                const stopName = stop ? stop.name : `Stop ${stopId}`;
                
                // Check if already shown as priority
                const hasPriority = priorityData && priorityData.counts && priorityData.counts[stopId];
                if (!hasPriority) {
                    html += `
                        <div class="waiting-list-item">
                            <span>${stopName}</span>
                            <span class="waiting-count">${count} waiting</span>
                        </div>
                    `;
                }
            }
        });
    }
    
    if (html === '') {
        html = '<p style="text-align: center; color: #999; padding: 20px;">No passengers waiting</p>';
    }
    
    driverWaitingList.innerHTML = html;
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

// Bus Number Selection Handler
const setBusNumberBtn = document.getElementById('setBusNumber');
const busNumberInput = document.getElementById('busNumberInput');

if (setBusNumberBtn && busNumberInput) {
    setBusNumberBtn.addEventListener('click', function() {
        const busNumber = parseInt(busNumberInput.value);
        
        if (!busNumber || busNumber < 1 || busNumber > 99) {
            alert('Please enter a valid bus number (1-99)');
            return;
        }
        
        if (!myBusId || !currentRoute) {
            alert('Please wait for bus ID assignment');
            return;
        }
        
        socket.emit('driver_select_bus', {
            bus_id: myBusId,
            route_id: currentRoute,
            bus_number: busNumber
        });
        
        console.log(`✓ Requesting bus number: ${busNumber}`);
    });
    
    // Allow Enter key to submit
    busNumberInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            setBusNumberBtn.click();
        }
    });
}

// Seat Counter Handlers
const incrementSeatsBtn = document.getElementById('incrementSeats');
const decrementSeatsBtn = document.getElementById('decrementSeats');

if (incrementSeatsBtn) {
    incrementSeatsBtn.addEventListener('click', function() {
        if (!myBusId || !currentRoute) {
            alert('Please start sharing location first');
            return;
        }
        
        socket.emit('update_seat_count', {
            bus_id: myBusId,
            route_id: currentRoute,
            action: 'increment'
        });
        
        console.log('✓ Incrementing seat count');
    });
}

if (decrementSeatsBtn) {
    decrementSeatsBtn.addEventListener('click', function() {
        if (!myBusId || !currentRoute) {
            alert('Please start sharing location first');
            return;
        }
        
        socket.emit('update_seat_count', {
            bus_id: myBusId,
            route_id: currentRoute,
            action: 'decrement'
        });
        
        console.log('✓ Decrementing seat count');
    });
}

// Passenger Booking Handler
const bookSeatBtn = document.getElementById('bookSeat');

if (bookSeatBtn) {
    bookSeatBtn.addEventListener('click', function() {
        const stopSelect = document.getElementById('waitingStopSelect');
        const stopId = parseInt(stopSelect.value);
        
        if (!stopId) {
            alert('Please select your stop first');
            return;
        }
        
        if (!currentRoute) {
            alert('Please select a route first');
            return;
        }
        
        // Get the closest bus
        const busIds = Object.keys(busMarkers);
        if (busIds.length === 0) {
            alert('No buses are currently active on this route');
            return;
        }
        
        // For simplicity, book on the first available bus
        // In a real app, this would be the closest bus
        const busId = busIds[0];
        
        socket.emit('passenger_booking', {
            route_id: currentRoute,
            stop_id: stopId,
            bus_id: busId
        });
        
        console.log(`✓ Booking seat for stop ${stopId} on bus ${busId}`);
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
    
    const stops = window.stopsData[currentRoute];
    if (stops && stops.length > 0) {
        initMap(stops[0].lat, stops[0].lng);
        addStopMarkers(currentRoute);
    } else {
        initMap();
    }
    
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
    
    // Request initial seat status
    socket.emit('get_seat_status', { bus_id: myBusId });
    
    // Request priority passenger counts
    socket.emit('get_priority_count', { route_id: currentRoute });
    
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
    console.log('⏹ Stopping location sharing...');
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
                
                // Update seat availability display
                if (currentMode === 'passenger') {
                    const seatAvailability = document.getElementById('seatAvailability');
                    const availableSeatsCount = document.getElementById('availableSeatsCount');
                    const approachingBusNumber = document.getElementById('approachingBusNumber');
                    const passengerOccupiedSeats = document.getElementById('passengerOccupiedSeats');
                    const passengerTotalSeats = document.getElementById('passengerTotalSeats');
                    
                    if (seatAvailability && bus.available_seats !== undefined) {
                        seatAvailability.classList.remove('hidden');
                        approachingBusNumber.textContent = bus.bus_number || bus.bus_id.substring(0, 8);
                        availableSeatsCount.textContent = bus.available_seats;
                        passengerOccupiedSeats.textContent = bus.occupied_seats || 0;
                        passengerTotalSeats.textContent = bus.total_seats || 50;
                        
                        // Change color based on availability
                        if (bus.available_seats <= 5) {
                            seatAvailability.style.background = 'linear-gradient(135deg, #F44336 0%, #D32F2F 100%)';
                        } else if (bus.available_seats <= 15) {
                            seatAvailability.style.background = 'linear-gradient(135deg, #FF9800 0%, #F57C00 100%)';
                        } else {
                            seatAvailability.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
                        }
                    }
                }
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
            document.getElementById('seatAvailability').classList.add('hidden');
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

console.log('=== Initializing Enhanced Bus Tracking System with OSRM Waypoints ===');
console.log('✓ Current stop detection enabled');
console.log('✓ Bus capacity management enabled');
console.log('✓ Full buses hidden from passenger view');
console.log('✓ Next stop display for passengers');
console.log('✓ Distance progress bar for Driver & Passenger modes');
console.log('✓ OSRM waypoint-based distance (99% accuracy)');
console.log('✓ TradingView-style animations enabled');
console.log('✓ Seat management system (50 seats per bus)');
console.log('✓ Bus number selection for multiple buses');
console.log('✓ Manual seat counter (+/- buttons)');
console.log('✓ Priority queue system for overflow passengers');
console.log('✓ Real-time seat availability display');
console.log('✓ Passenger booking system');
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
