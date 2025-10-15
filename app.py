from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import numpy as np
import pandas as pd
import pickle
import csv
from datetime import datetime, timedelta
import os
from collections import defaultdict
import uuid
import hashlib
import time
from threading import Lock
import sys

# Import the model class
try:
    from model_class import LinearRegressionNumpy
except ImportError:
    class LinearRegressionNumpy:
        def __init__(self):
            self.weights = None
            self.bias = None
        
        def fit(self, X, y, learning_rate=0.01, epochs=1000):
            n_samples, n_features = X.shape
            self.weights = np.zeros(n_features)
            self.bias = 0
            for _ in range(epochs):
                y_pred = np.dot(X, self.weights) + self.bias
                dw = (1/n_samples) * np.dot(X.T, (y_pred - y))
                db = (1/n_samples) * np.sum(y_pred - y)
                self.weights -= learning_rate * dw
                self.bias -= learning_rate * db
        
        def predict(self, X):
            return np.dot(X, self.weights) + self.bias
        
        def score(self, X, y):
            y_pred = self.predict(X)
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            ss_res = np.sum((y - y_pred) ** 2)
            return 1 - (ss_res / ss_tot)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
CORS(app, supports_credentials=True)

socketio = SocketIO(
    app, 
    cors_allowed_origins="*", 
    async_mode='eventlet',
    ping_timeout=60, 
    ping_interval=25,
    logger=False,
    engineio_logger=False,
    always_connect=True
)

DRIVERS_FILE = 'bus_drivers.csv'
LOCATIONS_FILE = 'bus_locations.csv'
HISTORY_FILE = 'bus_history.csv'

location_lock = Lock()
history_lock = Lock()
bus_data_lock = Lock()

# Bus stop coordinates
STOP_COORDS = {
    '48AC': [
        {'id': 1, 'name': 'Thirupallai', 'lat': 9.9720416, 'lng': 78.1394837},
        {'id': 2, 'name': 'Towards Iyer Bunglow', 'lat': 9.9718078, 'lng': 78.1392859},
        {'id': 3, 'name': 'Iyer Bungalow', 'lat': 9.9673249, 'lng': 78.1366866},
        {'id': 4, 'name': 'Reserve Line', 'lat': 9.9556417, 'lng': 78.1326311},
        {'id': 5, 'name': 'Race Course', 'lat': 9.9437216, 'lng': 78.1355206},
        {'id': 6, 'name': 'Pandian Hotel', 'lat': 9.9387971, 'lng': 78.1366364},
        {'id': 7, 'name': 'Thallakulam', 'lat': 9.9343902, 'lng': 78.1339649},
        {'id': 8, 'name': 'Tamukam', 'lat': 9.9310613, 'lng': 78.1319157},
        {'id': 9, 'name': 'Goripalaiyam', 'lat': 9.9291406, 'lng': 78.1292637},
        {'id': 10, 'name': 'A.V. Bridge Endpoint', 'lat': 9.9245982, 'lng': 78.124677},
        {'id': 11, 'name': 'Towards Simakkal', 'lat': 9.9239324, 'lng': 78.1240654},
        {'id': 12, 'name': 'Simakkal', 'lat': 9.9245618, 'lng': 78.1223503},
        {'id': 13, 'name': 'Towards Setupathi School', 'lat': 9.9247943, 'lng': 78.1176725},
        {'id': 14, 'name': 'Settupathi School', 'lat': 9.9240122, 'lng': 78.1134239},
        {'id': 15, 'name': 'Railway Junction', 'lat': 9.9178614, 'lng': 78.1121365},
        {'id': 16, 'name': 'Reaching Preiyar', 'lat': 9.9161166, 'lng': 78.1127373},
        {'id': 17, 'name': 'Periyar Bus Stand', 'lat': 9.915244, 'lng': 78.1115843},
        {'id': 18, 'name': 'Crime Branch', 'lat': 9.9117515, 'lng': 78.1118909},
        {'id': 19, 'name': 'Tamilnadu Polytechnic', 'lat': 9.9094264, 'lng': 78.1098096},
        {'id': 20, 'name': 'Vasantha Nagar', 'lat': 9.9060655, 'lng': 78.0991451},
        {'id': 21, 'name': 'Pallanganatham', 'lat': 9.9015843, 'lng': 78.0948536},
        {'id': 22, 'name': 'Paikara', 'lat': 9.8953204, 'lng': 78.0858491},
        {'id': 23, 'name': 'Pasumalai', 'lat': 9.8937178, 'lng': 78.0789968},
        {'id': 24, 'name': 'Mannar College', 'lat': 9.8929532, 'lng': 78.0770855},
        {'id': 25, 'name': 'Towards Thiruparakundram', 'lat': 9.886379, 'lng': 78.0741243},
        {'id': 26, 'name': 'Harveypatti', 'lat': 9.8804812, 'lng': 78.0648546},
        {'id': 27, 'name': 'Amman Tiffen', 'lat': 9.8809416, 'lng': 78.0562862},
        {'id': 28, 'name': 'Thirunagar 3Rd Stop', 'lat': 9.8821005, 'lng': 78.053083}
    ],
    '23': [
        {'id': 1, 'name': 'Thirupallai', 'lat': 9.9720416, 'lng': 78.1394837},
        {'id': 2, 'name': 'Towards Iyer Bunglow', 'lat': 9.9718078, 'lng': 78.1392859},
        {'id': 3, 'name': 'Iyer Bungalow', 'lat': 9.9673249, 'lng': 78.1366866},
        {'id': 4, 'name': 'Reserve Line', 'lat': 9.9556417, 'lng': 78.1326311},
        {'id': 5, 'name': 'Race Course', 'lat': 9.9437216, 'lng': 78.1355206},
        {'id': 6, 'name': 'Pandian Hotel', 'lat': 9.9387971, 'lng': 78.1366364},
        {'id': 7, 'name': 'Thallakulam', 'lat': 9.9343902, 'lng': 78.1339649},
        {'id': 8, 'name': 'Tamukam', 'lat': 9.9310613, 'lng': 78.1319157},
        {'id': 9, 'name': 'Goripalaiyam', 'lat': 9.9291406, 'lng': 78.1292637},
        {'id': 10, 'name': 'A.V. Bridge Endpoint', 'lat': 9.9245982, 'lng': 78.124677},
        {'id': 11, 'name': 'Towards Simakkal', 'lat': 9.9239324, 'lng': 78.1240654},
        {'id': 12, 'name': 'Simakkal', 'lat': 9.9245618, 'lng': 78.1223503},
        {'id': 13, 'name': 'Towards Setupathi School', 'lat': 9.9247943, 'lng': 78.1176725},
        {'id': 14, 'name': 'Settupathi School', 'lat': 9.9240122, 'lng': 78.1134239},
        {'id': 15, 'name': 'Railway Junction', 'lat': 9.9178614, 'lng': 78.1121365},
        {'id': 16, 'name': 'Reaching Preiyar', 'lat': 9.9161166, 'lng': 78.1127373},
        {'id': 17, 'name': 'Periyar Bus Stand', 'lat': 9.915244, 'lng': 78.1115843}
    ]
}

# Store active buses with enhanced data
active_buses = defaultdict(dict)
bus_speed_history = defaultdict(lambda: [])  # Track last 5 locations for speed calc
bus_start_location = defaultdict(dict)  # Track distance from first stop
bus_arrival_times = defaultdict(dict)
waiting_passengers = defaultdict(lambda: defaultdict(int))
authenticated_drivers = {}
bus_logged_locations = defaultdict(set)  # Prevent duplicate logging

# Load ML model
try:
    import sys
    sys.modules['train'] = sys.modules[__name__]
    
    with open('model.pkl', 'rb') as f:
        model = pickle.load(f)
    print("✓ ML Model loaded successfully")
except FileNotFoundError:
    model = None
    print("⚠ Warning: model.pkl not found. Run train.py first.")
except Exception as e:
    model = None
    print(f"⚠ Warning: Could not load model: {e}")

def init_drivers_file():
    if not os.path.isfile(DRIVERS_FILE):
        with open(DRIVERS_FILE, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['driver_id', 'password_hash', 'name', 'phone', 'license_number', 'created_at'])
            default_password_hash = hashlib.sha256('admin123'.encode()).hexdigest()
            writer.writerow([
                'DRIVER001',
                default_password_hash,
                'Admin Driver',
                '9876543210',
                'TN01234567890',
                datetime.now().isoformat()
            ])
        print("Created default driver: DRIVER001 / admin123")

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def verify_driver(driver_id, password):
    try:
        with open(DRIVERS_FILE, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row['driver_id'] == driver_id:
                    password_hash = hash_password(password)
                    if row['password_hash'] == password_hash:
                        return {
                            'driver_id': row['driver_id'],
                            'name': row['name'],
                            'phone': row['phone'],
                            'license_number': row['license_number']
                        }
        return None
    except Exception as e:
        print(f"Error verifying driver: {e}")
        return None

def register_driver(driver_id, password, name, phone, license_number):
    try:
        with open(DRIVERS_FILE, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row['driver_id'] == driver_id:
                    return {'success': False, 'message': 'Driver ID already exists'}
        
        with open(DRIVERS_FILE, 'a', newline='') as f:
            writer = csv.writer(f)
            password_hash = hash_password(password)
            writer.writerow([
                driver_id,
                password_hash,
                name,
                phone,
                license_number,
                datetime.now().isoformat()
            ])
        
        return {'success': True, 'message': 'Driver registered successfully'}
    except Exception as e:
        print(f"Error registering driver: {e}")
        return {'success': False, 'message': 'Registration failed'}

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    return R * c

def calculate_speed_from_history(bus_id, current_lat, current_lng, current_time):
    """Calculate speed using last 5 locations over time span"""
    with bus_data_lock:
        if bus_id not in bus_speed_history:
            bus_speed_history[bus_id] = []
        
        history = bus_speed_history[bus_id]
        history.append({
            'lat': current_lat,
            'lng': current_lng,
            'time': current_time
        })
        
        # Keep only last 5 locations
        if len(history) > 5:
            history.pop(0)
        
        # Need at least 2 points to calculate speed
        if len(history) < 2:
            return 0.0
        
        # Calculate speed from oldest to newest point
        oldest = history[0]
        newest = history[-1]
        
        distance_km = haversine_distance(oldest['lat'], oldest['lng'], 
                                         newest['lat'], newest['lng'])
        time_diff_seconds = (newest['time'] - oldest['time']).total_seconds()
        
        if time_diff_seconds > 0.1:  # Avoid division by very small numbers
            speed_kmh = (distance_km / time_diff_seconds) * 3600
            return min(speed_kmh, 120)  # Cap at 120 km/h
        
        return 0.0

def calculate_distance_from_start(route_id, bus_id, lat, lng):
    """Calculate cumulative distance from first stop"""
    with bus_data_lock:
        if bus_id not in bus_start_location:
            # Initialize with first stop coordinates
            if route_id in STOP_COORDS and len(STOP_COORDS[route_id]) > 0:
                first_stop = STOP_COORDS[route_id][0]
                bus_start_location[bus_id] = {
                    'start_lat': first_stop['lat'],
                    'start_lng': first_stop['lng']
                }
            else:
                return 0
        
        start = bus_start_location[bus_id]
        distance_from_start = haversine_distance(
            start['start_lat'], start['start_lng'], lat, lng
        )
        return distance_from_start

def find_nearest_stop(route_id, lat, lng):
    if route_id not in STOP_COORDS:
        return None
    
    min_distance = float('inf')
    nearest_stop = None
    
    for stop in STOP_COORDS[route_id]:
        distance = haversine_distance(lat, lng, stop['lat'], stop['lng'])
        if distance < min_distance:
            min_distance = distance
            nearest_stop = stop
    
    return nearest_stop, min_distance

def predict_eta(distance_km, traffic_level):
    if model is None:
        base_speed = 30
        speed = base_speed / traffic_level if traffic_level > 0 else base_speed
        return (distance_km / speed) * 60
    
    try:
        features = np.array([[distance_km, traffic_level]])
        prediction = model.predict(features)[0]
        return max(0.5, prediction)
    except Exception as e:
        print(f"Prediction error: {e}")
        return (distance_km / 30) * 60

def log_location_to_csv(route_id, bus_id, lat, lng, traffic_level, nearest_stop_id, 
                        nearest_stop_name, distance_km, speed_kmh, distance_from_start, driver_id=None):
    """Location logging with deduplication"""
    try:
        # Create location signature to prevent exact duplicates
        loc_signature = f"{bus_id}_{round(lat, 6)}_{round(lng, 6)}"
        
        with bus_data_lock:
            if loc_signature in bus_logged_locations[bus_id]:
                return  # Skip duplicate
            bus_logged_locations[bus_id].add(loc_signature)
            
            # Keep only last 200 signatures to prevent memory bloat
            if len(bus_logged_locations[bus_id]) > 200:
                old_sigs = list(bus_logged_locations[bus_id])
                for sig in old_sigs[:-200]:
                    bus_logged_locations[bus_id].discard(sig)
        
        with location_lock:
            file_exists = os.path.isfile(LOCATIONS_FILE)
            
            with open(LOCATIONS_FILE, 'a', newline='') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['timestamp', 'route_id', 'bus_id', 'driver_id', 
                                   'latitude', 'longitude', 'traffic_level', 
                                   'nearest_stop_id', 'nearest_stop_name', 
                                   'distance_to_stop_km', 'distance_from_start_km', 'speed_kmh'])
                
                writer.writerow([
                    datetime.now().isoformat(),
                    route_id,
                    bus_id,
                    driver_id or 'N/A',
                    f"{lat:.6f}",
                    f"{lng:.6f}",
                    traffic_level,
                    nearest_stop_id,
                    nearest_stop_name,
                    f"{distance_km:.3f}",
                    f"{distance_from_start:.3f}",
                    f"{speed_kmh:.2f}"
                ])
            
            # Auto-cleanup if file exceeds 10 MB
            if os.path.getsize(LOCATIONS_FILE) > 10 * 1024 * 1024:
                cleanup_location_history()
    except Exception as e:
        print(f"Location logging error: {e}")

def cleanup_location_history():
    try:
        with location_lock:
            with open(LOCATIONS_FILE, 'r') as f:
                reader = list(csv.reader(f))
            
            header = reader[0]
            data = reader[1:]
            keep_count = int(len(data) * 0.8)
            
            with open(LOCATIONS_FILE, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(header)
                writer.writerows(data[-keep_count:])
            print(f"✓ Cleaned up location history. Kept {keep_count} records.")
    except Exception as e:
        print(f"Cleanup error: {e}")

def log_arrival(route_id, stop_id, stop_name, predicted_time_min, actual_time_min, 
                distance_km, bus_id, driver_id, speed_kmh, distance_from_start):
    try:
        with history_lock:
            file_exists = os.path.isfile(HISTORY_FILE)
            
            with open(HISTORY_FILE, 'a', newline='') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['timestamp', 'route_id', 'bus_id', 'driver_id', 
                                   'stop_id', 'stop_name', 'predicted_time_min', 
                                   'actual_time_min', 'distance_km', 'distance_from_start_km', 'speed_kmh'])
                
                writer.writerow([
                    datetime.now().isoformat(),
                    route_id,
                    bus_id,
                    driver_id or 'N/A',
                    stop_id,
                    stop_name,
                    f"{predicted_time_min:.2f}",
                    f"{actual_time_min:.2f}",
                    f"{distance_km:.3f}",
                    f"{distance_from_start:.3f}",
                    f"{speed_kmh:.2f}"
                ])
                
                print(f"✓ Logged arrival at {stop_name}: Predicted={predicted_time_min:.1f}min, Actual={actual_time_min:.1f}min")
    except Exception as e:
        print(f"Arrival logging error: {e}")

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/routes')
def get_routes():
    return jsonify({
        'routes': list(STOP_COORDS.keys()),
        'stops': STOP_COORDS
    })

@app.route('/api/waiting_stats')
def get_waiting_stats():
    return jsonify(dict(waiting_passengers))

@app.route('/api/active_buses/<route_id>')
def get_active_buses(route_id):
    buses = []
    if route_id in active_buses:
        for bus_id, bus_data in active_buses[route_id].items():
            buses.append({
                'bus_id': bus_id,
                'lat': bus_data['lat'],
                'lng': bus_data['lng'],
                'traffic_level': bus_data.get('traffic_level', 1),
                'timestamp': bus_data.get('timestamp'),
                'driver_name': bus_data.get('driver_name', 'Unknown'),
                'speed': bus_data.get('speed', 0),
                'nearest_stop': bus_data.get('nearest_stop', 'Unknown')
            })
    return jsonify({'buses': buses})

@app.route('/api/driver/register', methods=['POST'])
def driver_register():
    data = request.json
    driver_id = data.get('driver_id')
    password = data.get('password')
    name = data.get('name')
    phone = data.get('phone')
    license_number = data.get('license_number')
    
    if not all([driver_id, password, name, phone, license_number]):
        return jsonify({'success': False, 'message': 'All fields required'}), 400
    
    result = register_driver(driver_id, password, name, phone, license_number)
    
    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 400

@socketio.on('connect')
def handle_connect():
    print(f"✓ Client connected: {request.sid}")
    emit('connected', {'status': 'connected', 'sid': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    try:
        print(f"✗ Client disconnected: {request.sid}")
        
        if request.sid in authenticated_drivers:
            del authenticated_drivers[request.sid]
        
        for route_id in list(active_buses.keys()):
            for bus_id in list(active_buses[route_id].keys()):
                if active_buses[route_id][bus_id].get('sid') == request.sid:
                    del active_buses[route_id][bus_id]
                    # Clean up tracking data
                    if bus_id in bus_speed_history:
                        del bus_speed_history[bus_id]
                    if bus_id in bus_start_location:
                        del bus_start_location[bus_id]
                    if bus_id in bus_logged_locations:
                        del bus_logged_locations[bus_id]
                    socketio.emit('bus_removed', {
                        'route_id': route_id,
                        'bus_id': bus_id
                    }, room=route_id)
                    print(f"Removed bus {bus_id} from route {route_id}")
                    break
    except Exception as e:
        print(f"Error in disconnect handler: {e}")

@socketio.on('driver_authenticate')
def handle_driver_authenticate(data):
    driver_id = data.get('driver_id')
    password = data.get('password')
    
    driver_info = verify_driver(driver_id, password)
    
    if driver_info:
        authenticated_drivers[request.sid] = driver_info
        emit('driver_authenticated', {
            'success': True,
            'driver': driver_info
        })
        print(f"✓ Driver authenticated: {driver_id}")
    else:
        emit('driver_authenticated', {
            'success': False,
            'message': 'Invalid credentials'
        })

@socketio.on('join_route')
def handle_join_route(data):
    route_id = data.get('route_id')
    mode = data.get('mode', 'passenger')
    
    join_room(route_id)
    print(f"✓ Client {request.sid} joined route {route_id} as {mode}")
    
    if mode == 'bus':
        if request.sid not in authenticated_drivers:
            emit('authentication_required', {'message': 'Please authenticate first'})
            return
        
        driver_info = authenticated_drivers[request.sid]
        bus_id = str(uuid.uuid4())[:8]
        emit('bus_id_assigned', {
            'bus_id': bus_id,
            'driver_name': driver_info['name']
        })
        
        socketio.emit('bus_count_update', {
            'route_id': route_id,
            'count': len(active_buses[route_id])
        }, room=route_id)
    else:
        buses = []
        if route_id in active_buses:
            for bus_id, bus_data in active_buses[route_id].items():
                result = find_nearest_stop(route_id, bus_data['lat'], bus_data['lng'])
                if result:
                    nearest_stop, distance_km = result
                    eta_minutes = predict_eta(distance_km, bus_data.get('traffic_level', 1))
                    buses.append({
                        'bus_id': bus_id,
                        'lat': bus_data['lat'],
                        'lng': bus_data['lng'],
                        'eta_minutes': round(eta_minutes, 1),
                        'distance_km': round(distance_km, 2),
                        'nearest_stop': nearest_stop,
                        'traffic_level': bus_data.get('traffic_level', 1),
                        'driver_name': bus_data.get('driver_name', 'Unknown'),
                        'speed': bus_data.get('speed', 0)
                    })
        
        emit('all_buses_update', {
            'route_id': route_id,
            'buses': buses
        })

@socketio.on('leave_route')
def handle_leave_route(data):
    route_id = data.get('route_id')
    mode = data.get('mode', 'passenger')
    bus_id = data.get('bus_id')
    
    leave_room(route_id)
    print(f"✗ Client {request.sid} left route {route_id}")
    
    if mode == 'bus' and bus_id and route_id in active_buses:
        if bus_id in active_buses[route_id]:
            del active_buses[route_id][bus_id]
            # Clean up tracking data
            if bus_id in bus_speed_history:
                del bus_speed_history[bus_id]
            if bus_id in bus_start_location:
                del bus_start_location[bus_id]
            if bus_id in bus_logged_locations:
                del bus_logged_locations[bus_id]
            socketio.emit('bus_removed', {
                'route_id': route_id,
                'bus_id': bus_id
            }, room=route_id)

@socketio.on('bus_location')
def handle_bus_location(data):
    if request.sid not in authenticated_drivers:
        emit('authentication_required', {'message': 'Please authenticate first'})
        return
    
    driver_info = authenticated_drivers[request.sid]
    
    route_id = data.get('route_id')
    lat = data.get('lat')
    lng = data.get('lng')
    traffic_level = data.get('traffic_level', 1)
    bus_id = data.get('bus_id')
    
    if not all([route_id, lat, lng, bus_id]):
        return
    
    current_time = datetime.now()
    
    # Calculate speed from last 5 seconds of history
    speed_kmh = calculate_speed_from_history(bus_id, lat, lng, current_time)
    
    # Calculate distance from start
    distance_from_start = calculate_distance_from_start(route_id, bus_id, lat, lng)
    
    # Find nearest stop
    result = find_nearest_stop(route_id, lat, lng)
    if not result:
        return
    
    nearest_stop, distance_km = result
    
    # Predict ETA
    eta_minutes = predict_eta(distance_km, traffic_level)
    
    # Store bus location with enhanced data
    with bus_data_lock:
        active_buses[route_id][bus_id] = {
            'lat': lat,
            'lng': lng,
            'traffic_level': traffic_level,
            'timestamp': current_time.isoformat(),
            'sid': request.sid,
            'driver_id': driver_info['driver_id'],
            'driver_name': driver_info['name'],
            'speed': round(speed_kmh, 2),
            'nearest_stop': nearest_stop['name'],
            'distance_to_stop': round(distance_km, 3)
        }
    
    # Log location with enhanced data
    log_location_to_csv(route_id, bus_id, lat, lng, traffic_level, 
                        nearest_stop['id'], nearest_stop['name'],
