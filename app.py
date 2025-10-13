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
    # Define it inline if import fails
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
bus_last_location = {}  # Track previous location for speed calculation
bus_arrival_times = defaultdict(dict)  # Track predicted arrival times
waiting_passengers = defaultdict(lambda: defaultdict(int))
authenticated_drivers = {}

# Load ML model
try:
    # Set the correct module for unpickling
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
    print("  The system will use fallback ETA calculation.")

def init_drivers_file():
    """Initialize drivers CSV file"""
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
    """Calculate distance in kilometers"""
    R = 6371
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    return R * c

def calculate_speed(bus_id, current_lat, current_lng, current_time):
    """Calculate speed in km/h based on previous location"""
    if bus_id not in bus_last_location:
        return 0.0
    
    prev = bus_last_location[bus_id]
    distance_km = haversine_distance(prev['lat'], prev['lng'], current_lat, current_lng)
    time_diff_seconds = (current_time - prev['time']).total_seconds()
    
    if time_diff_seconds > 0:
        speed_kmh = (distance_km / time_diff_seconds) * 3600
        return min(speed_kmh, 100)  # Cap at 100 km/h
    return 0.0

def find_nearest_stop(route_id, lat, lng):
    """Find nearest stop"""
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
    """Predict ETA using trained model"""
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
                        nearest_stop_name, distance_km, speed_kmh, driver_id=None):
    """Enhanced location logging with stop info and speed"""
    try:
        with location_lock:
            file_exists = os.path.isfile(LOCATIONS_FILE)
            
            with open(LOCATIONS_FILE, 'a', newline='') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['timestamp', 'route_id', 'bus_id', 'driver_id', 
                                   'latitude', 'longitude', 'traffic_level', 
                                   'nearest_stop_id', 'nearest_stop_name', 
                                   'distance_to_stop_km', 'speed_kmh'])
                
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
                    f"{speed_kmh:.2f}"
                ])
            
            # Auto-cleanup if file exceeds 10 MB
            if os.path.getsize(LOCATIONS_FILE) > 10 * 1024 * 1024:
                cleanup_location_history()
    except Exception as e:
        print(f"Location logging error: {e}")

def cleanup_location_history():
    """Keep most recent 80% of records"""
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
                distance_km, bus_id, driver_id, speed_kmh):
    """Enhanced arrival logging with actual time calculation"""
    try:
        with history_lock:
            file_exists = os.path.isfile(HISTORY_FILE)
            
            with open(HISTORY_FILE, 'a', newline='') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['timestamp', 'route_id', 'bus_id', 'driver_id', 
                                   'stop_id', 'stop_name', 'predicted_time_min', 
                                   'actual_time_min', 'distance_km', 'speed_kmh'])
                
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
                    if bus_id in bus_last_location:
                        del bus_last_location[bus_id]
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
            if bus_id in bus_last_location:
                del bus_last_location[bus_id]
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
    
    # Calculate speed
    speed_kmh = calculate_speed(bus_id, lat, lng, current_time)
    
    # Update last location for next speed calculation
    bus_last_location[bus_id] = {
        'lat': lat,
        'lng': lng,
        'time': current_time
    }
    
    # Find nearest stop
    result = find_nearest_stop(route_id, lat, lng)
    if not result:
        return
    
    nearest_stop, distance_km = result
    
    # Predict ETA
    eta_minutes = predict_eta(distance_km, traffic_level)
    
    # Store bus location with enhanced data
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
                        distance_km, speed_kmh, driver_info['driver_id'])
    
    # Check if arriving at stop (within 100 meters)
    if distance_km < 0.1:
        # Calculate actual time if we have a previous prediction
        bus_stop_key = f"{bus_id}_{nearest_stop['id']}"
        actual_time_min = eta_minutes
        
        if bus_stop_key in bus_arrival_times:
            prev_prediction = bus_arrival_times[bus_stop_key]
            time_elapsed = (current_time - prev_prediction['time']).total_seconds() / 60
            actual_time_min = time_elapsed
        
        log_arrival(route_id, nearest_stop['id'], nearest_stop['name'], 
                   eta_minutes, actual_time_min, distance_km, bus_id, 
                   driver_info['driver_id'], speed_kmh)
        
        # Clear prediction for this stop
        if bus_stop_key in bus_arrival_times:
            del bus_arrival_times[bus_stop_key]
    else:
        # Store prediction for future arrival calculation
        bus_stop_key = f"{bus_id}_{nearest_stop['id']}"
        bus_arrival_times[bus_stop_key] = {
            'time': current_time,
            'predicted_eta': eta_minutes
        }
    
    # Send update to driver with enhanced info
    emit('bus_info_update', {
        'speed': round(speed_kmh, 2),
        'nearest_stop': nearest_stop['name'],
        'distance_to_stop': round(distance_km, 3),
        'eta_to_stop': round(eta_minutes, 1)
    })
    
    # Broadcast to passengers
    socketio.emit('bus_update', {
        'route_id': route_id,
        'bus_id': bus_id,
        'lat': lat,
        'lng': lng,
        'eta_minutes': round(eta_minutes, 1),
        'distance_km': round(distance_km, 2),
        'nearest_stop': nearest_stop,
        'traffic_level': traffic_level,
        'driver_name': driver_info['name'],
        'speed': round(speed_kmh, 2)
    }, room=route_id, include_self=False)
    
    # Update bus count
    socketio.emit('bus_count_update', {
        'route_id': route_id,
        'count': len(active_buses[route_id])
    }, room=route_id)
    
    # Use sleep to prevent conflicts (handled by eventlet)
    time.sleep(0.01)

@socketio.on('passenger_waiting')
def handle_passenger_waiting(data):
    route_id = data.get('route_id')
    stop_id = data.get('stop_id')
    is_waiting = data.get('is_waiting', True)
    
    if not all([route_id, stop_id is not None]):
        return
    
    if is_waiting:
        waiting_passengers[route_id][stop_id] += 1
    else:
        if waiting_passengers[route_id][stop_id] > 0:
            waiting_passengers[route_id][stop_id] -= 1
    
    socketio.emit('waiting_update', {
        'route_id': route_id,
        'stop_id': stop_id,
        'count': waiting_passengers[route_id][stop_id]
    }, room=route_id)
    
    socketio.emit('waiting_stats', dict(waiting_passengers))

@app.route('/favicon.ico')
def favicon():
    return send_from_directory('static', 'favicon.ico', mimetype='image/vnd.microsoft.icon')

if __name__ == '__main__':
    print("=" * 70)
    print("🚌 Starting Enhanced Bus Tracking Server")
    print("=" * 70)
    print("✓ Real-time location logging with speed and stop info")
    print("✓ Enhanced arrival tracking with actual time calculation")
    print("✓ Location updates every 1 second with conflict prevention")
    print("=" * 70)
    
    init_drivers_file()
    
    try:
        socketio.run(
            app, 
            debug=False,
            host='0.0.0.0', 
            port=5000,
            use_reloader=False,
            log_output=False
        )
    except KeyboardInterrupt:
        print("\n✗ Shutting down server...")
    except Exception as e:
        print(f"✗ Server error: {e}")
