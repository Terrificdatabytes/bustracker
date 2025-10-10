from flask import Flask, render_template, request, jsonify, send_from_directory, session
from train import LinearRegressionNumpy
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import numpy as np
import pickle
import csv
import sys
from datetime import datetime
import os
from collections import defaultdict
import uuid
import hashlib

sys.modules['__main__'] = sys.modules['train']
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
CORS(app, supports_credentials=True)

# FIXED: Updated SocketIO configuration with error handling
socketio = SocketIO(
    app, 
    cors_allowed_origins="*", 
    async_mode='eventlet',  # Changed to eventlet
    ping_timeout=60, 
    ping_interval=25,
    logger=False,
    engineio_logger=False,
    always_connect=True
)

# Driver credentials file
DRIVERS_FILE = 'bus_drivers.csv'

def init_drivers_file():
    """Initialize drivers CSV file with default admin if not exists"""
    if not os.path.isfile(DRIVERS_FILE):
        with open(DRIVERS_FILE, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['driver_id', 'password_hash', 'name', 'phone', 'license_number', 'created_at'])
            # Add default driver (password: admin123)
            default_password_hash = hashlib.sha256('admin123'.encode()).hexdigest()
            writer.writerow([
                'DRIVER001',
                default_password_hash,
                'Admin Driver',
                '9876543210',
                'TN01234567890',
                datetime.now().isoformat()
            ])
        print("Created default driver account: DRIVER001 / admin123")

def hash_password(password):
    """Hash password using SHA256"""
    return hashlib.sha256(password.encode()).hexdigest()

def verify_driver(driver_id, password):
    """Verify driver credentials"""
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
    """Register new driver"""
    try:
        # Check if driver_id already exists
        with open(DRIVERS_FILE, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row['driver_id'] == driver_id:
                    return {'success': False, 'message': 'Driver ID already exists'}
        
        # Add new driver
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

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

# Bus stop coordinates
STOP_COORDS = {
    '24A': [
        {'id': 1, 'name': 'Central Station', 'lat': 9.9252, 'lng': 78.1198},
        {'id': 2, 'name': 'Anna Nagar', 'lat': 9.9312, 'lng': 78.1245},
        {'id': 3, 'name': 'Periyar Bus Stand', 'lat': 9.9195, 'lng': 78.1133},
        {'id': 4, 'name': 'Meenakshi Temple', 'lat': 9.9195, 'lng': 78.1193},
        {'id': 5, 'name': 'Railway Junction', 'lat': 9.9252, 'lng': 78.1198},
    ],
    '2A': [
        {'id': 1, 'name': 'Arappalayam', 'lat': 9.9388, 'lng': 78.1212},
        {'id': 2, 'name': 'Mattuthavani', 'lat': 9.9028, 'lng': 78.1478},
        {'id': 3, 'name': 'Thiruparankundram', 'lat': 9.8751, 'lng': 78.0706},
    ],

'48AC': [
    {'id': 1, 'name': 'Oomachikulam', 'lat': 9.9958, 'lng': 78.1448},
    {'id': 2, 'name': 'Periyar', 'lat': 9.9159, 'lng': 78.1117},
    {'id': 3, 'name': 'Simmakkal', 'lat': 9.9261, 'lng': 78.1215},
    {'id': 4, 'name': 'Goripalayam', 'lat': 9.9330, 'lng': 78.1290},
    {'id': 5, 'name': 'Thirupalai', 'lat': 9.9825, 'lng': 78.1430},
    {'id': 6, 'name': 'Thirunagar 2nd Stop', 'lat': 9.8887, 'lng': 78.0495},
    {'id': 7, 'name': 'Thirunagar 3rd Stop', 'lat': 9.8805, 'lng': 78.0468},
    {'id': 8, 'name': 'Iyer Bungalow', 'lat': 9.9670, 'lng': 78.1344},
    {'id': 9, 'name': 'Thatankulam', 'lat': 9.9203, 'lng': 78.1421},
    {'id': 10, 'name': 'AURCM Madurai', 'lat': 9.9335, 'lng': 78.1382}
]
    
}

# Store active buses with their current locations and metadata
active_buses = defaultdict(dict)  # {route_id: {bus_id: {lat, lng, traffic, timestamp, sid, driver_info}}}
waiting_passengers = defaultdict(lambda: defaultdict(int))  # {route_id: {stop_id: count}}
authenticated_drivers = {}  # {sid: driver_info}

# Load ML model
try:
    with open('model.pkl', 'rb') as f:
        model = pickle.load(f)
except FileNotFoundError:
    model = None
    print("Warning: model.pkl not found. Run train_model.py first.")

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance between two points in kilometers"""
    R = 6371  # Earth's radius in km
    
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    
    return R * c

def find_nearest_stop(route_id, lat, lng):
    """Find nearest stop for given coordinates"""
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
    """Predict ETA using the trained model"""
    if model is None:
        # Fallback calculation if model not available
        base_speed = 30  # km/h
        speed = base_speed / traffic_level if traffic_level > 0 else base_speed
        return (distance_km / speed) * 60  # Convert to minutes
    
    try:
        features = np.array([[distance_km, traffic_level]])
        prediction = model.predict(features)[0]
        return max(0.5, prediction)  # Minimum 0.5 minutes
    except Exception as e:
        print(f"Prediction error: {e}")
        return (distance_km / 30) * 60

def log_location_to_csv(route_id, bus_id, lat, lng, traffic_level, nearest_stop_id, distance_km, driver_id=None):
    """Log real-time bus location data to CSV"""
    try:
        file_exists = os.path.isfile('bus_locations.csv')
        
        with open('bus_locations.csv', 'a', newline='') as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(['timestamp', 'route_id', 'bus_id', 'driver_id', 'latitude', 'longitude', 
                               'traffic_level', 'nearest_stop_id', 'distance_to_stop_km'])
            
            writer.writerow([
                datetime.now().isoformat(),
                route_id,
                bus_id,
                driver_id or 'N/A',
                f"{lat:.6f}",
                f"{lng:.6f}",
                traffic_level,
                nearest_stop_id,
                f"{distance_km:.3f}"
            ])
        
        # Auto-cleanup if file exceeds 9 MB
        if os.path.getsize('bus_locations.csv') > 9 * 1024 * 1024:
            cleanup_location_history()
    except Exception as e:
        print(f"Location logging error: {e}")

def cleanup_location_history():
    """Keep most recent 80% of records"""
    try:
        with open('bus_locations.csv', 'r') as f:
            reader = list(csv.reader(f))
        
        header = reader[0]
        data = reader[1:]
        keep_count = int(len(data) * 0.8)
        
        with open('bus_locations.csv', 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(header)
            writer.writerows(data[-keep_count:])
        print(f"Cleaned up location history. Kept {keep_count} records.")
    except Exception as e:
        print(f"Cleanup error: {e}")

def log_arrival(route_id, stop_id, predicted_time, actual_time, distance_km):
    """Log bus arrival to CSV"""
    try:
        file_exists = os.path.isfile('bus_history.csv')
        
        with open('bus_history.csv', 'a', newline='') as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(['timestamp', 'route_id', 'stop_id', 'predicted_time', 
                               'actual_time', 'distance_km'])
            
            writer.writerow([
                datetime.now().isoformat(),
                route_id,
                stop_id,
                f"{predicted_time:.2f}",
                f"{actual_time:.2f}",
                f"{distance_km:.2f}"
            ])
    except Exception as e:
        print(f"Arrival logging error: {e}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/routes')
def get_routes():
    """Get available routes and their stops"""
    return jsonify({
        'routes': list(STOP_COORDS.keys()),
        'stops': STOP_COORDS
    })

@app.route('/api/waiting_stats')
def get_waiting_stats():
    """Get waiting passenger statistics"""
    return jsonify(dict(waiting_passengers))

@app.route('/api/active_buses/<route_id>')
def get_active_buses(route_id):
    """Get all active buses for a route"""
    buses = []
    if route_id in active_buses:
        for bus_id, bus_data in active_buses[route_id].items():
            buses.append({
                'bus_id': bus_id,
                'lat': bus_data['lat'],
                'lng': bus_data['lng'],
                'traffic_level': bus_data.get('traffic_level', 1),
                'timestamp': bus_data.get('timestamp'),
                'driver_name': bus_data.get('driver_name', 'Unknown')
            })
    return jsonify({'buses': buses})

@app.route('/api/driver/login', methods=['POST'])
def driver_login():
    """Driver login endpoint"""
    data = request.json
    driver_id = data.get('driver_id')
    password = data.get('password')
    
    if not driver_id or not password:
        return jsonify({'success': False, 'message': 'Driver ID and password required'}), 400
    
    driver_info = verify_driver(driver_id, password)
    
    if driver_info:
        return jsonify({'success': True, 'driver': driver_info})
    else:
        return jsonify({'success': False, 'message': 'Invalid credentials'}), 401

@app.route('/api/driver/register', methods=['POST'])
def driver_register():
    """Driver registration endpoint"""
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
    print(f"Client connected: {request.sid}")
    emit('connected', {'status': 'connected', 'sid': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    try:
        print(f"Client disconnected: {request.sid}")
        
        # Remove from authenticated drivers
        if request.sid in authenticated_drivers:
            del authenticated_drivers[request.sid]
        
        # Remove bus from active buses if it was a bus driver
        for route_id in list(active_buses.keys()):
            for bus_id in list(active_buses[route_id].keys()):
                if active_buses[route_id][bus_id].get('sid') == request.sid:
                    del active_buses[route_id][bus_id]
                    # Notify passengers that bus is gone
                    socketio.emit('bus_removed', {
                        'route_id': route_id,
                        'bus_id': bus_id
                    }, room=route_id)
                    print(f"Removed bus {bus_id} from route {route_id}")
                    break
    except Exception as e:
        print(f"Error in disconnect handler: {e}")
        pass

@socketio.on('driver_authenticate')
def handle_driver_authenticate(data):
    """Authenticate driver via socket"""
    driver_id = data.get('driver_id')
    password = data.get('password')
    
    driver_info = verify_driver(driver_id, password)
    
    if driver_info:
        authenticated_drivers[request.sid] = driver_info
        emit('driver_authenticated', {
            'success': True,
            'driver': driver_info
        })
        print(f"Driver authenticated: {driver_id}")
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
    print(f"Client {request.sid} joined route {route_id} as {mode}")
    
    if mode == 'bus':
        # Check if driver is authenticated
        if request.sid not in authenticated_drivers:
            emit('authentication_required', {'message': 'Please authenticate first'})
            return
        
        driver_info = authenticated_drivers[request.sid]
        
        # Generate unique bus ID for this session
        bus_id = str(uuid.uuid4())[:8]
        emit('bus_id_assigned', {
            'bus_id': bus_id,
            'driver_name': driver_info['name']
        })
        
        # Send current active buses count
        socketio.emit('bus_count_update', {
            'route_id': route_id,
            'count': len(active_buses[route_id])
        }, room=route_id)
    else:
        # Send all active buses to the newly joined passenger
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
                        'driver_name': bus_data.get('driver_name', 'Unknown')
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
    print(f"Client {request.sid} left route {route_id}")
    
    if mode == 'bus' and bus_id and route_id in active_buses:
        if bus_id in active_buses[route_id]:
            del active_buses[route_id][bus_id]
            # Notify passengers that bus is gone
            socketio.emit('bus_removed', {
                'route_id': route_id,
                'bus_id': bus_id
            }, room=route_id)

@socketio.on('bus_location')
def handle_bus_location(data):
    # Check if driver is authenticated
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
    
    # Store bus location with driver info
    active_buses[route_id][bus_id] = {
        'lat': lat,
        'lng': lng,
        'traffic_level': traffic_level,
        'timestamp': datetime.now().isoformat(),
        'sid': request.sid,
        'driver_id': driver_info['driver_id'],
        'driver_name': driver_info['name']
    }
    
    # Find nearest stop
    result = find_nearest_stop(route_id, lat, lng)
    if not result:
        return
    
    nearest_stop, distance_km = result
    
    # Predict ETA
    eta_minutes = predict_eta(distance_km, traffic_level)
    
    # Log location to CSV with driver info
    log_location_to_csv(route_id, bus_id, lat, lng, traffic_level, 
                        nearest_stop['id'], distance_km, driver_info['driver_id'])
    
    # Log arrival if very close to stop
    if distance_km < 0.1:  # Within 100 meters
        log_arrival(route_id, nearest_stop['id'], eta_minutes, 0, distance_km)
    
    # Broadcast to all passengers on this route with bus_id
    socketio.emit('bus_update', {
        'route_id': route_id,
        'bus_id': bus_id,
        'lat': lat,
        'lng': lng,
        'eta_minutes': round(eta_minutes, 1),
        'distance_km': round(distance_km, 2),
        'nearest_stop': nearest_stop,
        'traffic_level': traffic_level,
        'driver_name': driver_info['name']
    }, room=route_id, include_self=False)
    
    # Update bus count
    socketio.emit('bus_count_update', {
        'route_id': route_id,
        'count': len(active_buses[route_id])
    }, room=route_id)

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
    
    # Broadcast updated waiting stats (removed broadcast parameter)
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
    print("Starting Bus Tracking Server...")
    print("Real-time location logging enabled to bus_locations.csv")
    
    # Initialize drivers file
    init_drivers_file()
    
    # FIXED: Use eventlet and proper error handling
    try:
        socketio.run(
            app, 
            debug=False,  # Set to False to avoid refresh errors
            host='0.0.0.0', 
            port=5000,
            use_reloader=False,  # Disable reloader to prevent refresh issues
            log_output=False
        )
    except KeyboardInterrupt:
        print("\nShutting down server...")
    except Exception as e:
        print(f"Server error: {e}")
