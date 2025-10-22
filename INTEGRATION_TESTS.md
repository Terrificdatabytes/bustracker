# Integration Test Plan for Seat Management & Priority Queue

## Overview
This document outlines the integration tests for the new seat management and priority queue features.

## Test Environment Setup

### Prerequisites
1. Python 3.8+
2. Flask and dependencies installed
3. Server running on localhost:5000
4. WebSocket connection enabled

### Installation
```bash
pip install flask flask-socketio flask-cors numpy eventlet
python app.py
```

## Integration Test Cases

### Test 1: Driver Bus Number Selection

**Objective:** Verify driver can select and set bus number

**Steps:**
1. Login as driver (DRIVER001 / admin123)
2. Select route (e.g., 48AC)
3. Enter bus mode
4. Select bus number from dropdown or enter custom
5. Click "Set Bus Number"

**Expected Results:**
- Bus number is displayed below the input
- WebSocket event `bus_number_set` is received
- Bus number appears in passenger view
- Input form is hidden after setting

**Test Data:**
- Bus numbers: BUS-001, BUS-002, BUS-003, Custom: "TEST-BUS-99"

---

### Test 2: Manual Seat Counter - Increment

**Objective:** Verify driver can increment occupied seats

**Steps:**
1. Login as driver
2. Start sharing location on route
3. Note current occupied seats (should be 0)
4. Click "+" button 5 times
5. Verify seat count updates

**Expected Results:**
- Occupied seats increases from 0 to 5
- Available seats decreases from 48 to 43
- WebSocket event `update_seat_count` is sent
- Passengers see updated seat availability
- No error when clicking beyond capacity

**Test Data:**
- Initial: 0/48
- After 5 clicks: 5/48
- After 48 clicks: 48/48 (full)
- After 49 clicks: still 48/48 (capped)

---

### Test 3: Manual Seat Counter - Decrement

**Objective:** Verify driver can decrement occupied seats

**Steps:**
1. Set occupied seats to 20
2. Click "-" button 5 times
3. Verify seat count updates
4. Click "-" button 20 times
5. Verify it doesn't go below 0

**Expected Results:**
- Occupied seats decreases from 20 to 15
- Available seats increases from 28 to 33
- Cannot go below 0
- WebSocket event `update_seat_count` is sent

**Test Data:**
- Initial: 20/48
- After 5 decrements: 15/48
- After 20 decrements: 0/48 (minimum)

---

### Test 4: Reset Seat Counter

**Objective:** Verify reset button sets counter to 0

**Steps:**
1. Set occupied seats to 35
2. Click "Reset to 0" button
3. Confirm dialog
4. Verify counter resets

**Expected Results:**
- Occupied seats becomes 0
- Available seats becomes 48
- WebSocket event sent with occupied_seats: 0

---

### Test 5: Automatic Bus Full Detection

**Objective:** Verify bus is automatically marked full at capacity

**Steps:**
1. Set occupied seats to 47
2. Click "+" button once
3. Observe capacity toggle

**Expected Results:**
- Occupied seats becomes 48
- Available seats becomes 0
- Capacity toggle automatically checks to "Full"
- Bus is hidden from passenger view
- Notification sent to passengers

---

### Test 6: Waiting Passenger Count Display

**Objective:** Verify driver sees real-time waiting passenger count

**Steps:**
1. Login as driver on route 48AC
2. Open passenger view in another browser/tab
3. As passenger, select stop and mark as waiting
4. Switch back to driver view

**Expected Results:**
- Driver sees waiting passenger count increase by 1
- Count updates in real-time via WebSocket
- Count shows total across all stops on route

---

### Test 7: Passenger Seat Availability Display

**Objective:** Verify passengers see real-time seat availability

**Steps:**
1. Login as passenger
2. Select route and stop
3. Start tracking bus
4. Driver updates seat count
5. Observe passenger view

**Expected Results:**
- Passenger sees bus number
- Passenger sees occupied seats count
- Passenger sees available seats count
- Color changes based on availability:
  - Green: > 10 seats available
  - Orange: < 10 seats available
  - Red: 0 seats available

---

### Test 8: Priority Queue - Auto Join

**Objective:** Verify passengers auto-join queue when bus is full

**Steps:**
1. Driver sets occupied seats to 48 (full)
2. Passenger is tracking on route
3. Observe passenger view

**Expected Results:**
- Priority queue section becomes visible
- Passenger is automatically added to queue
- Queue position is displayed
- WebSocket event `join_priority_queue` is sent
- Notification shown: "Bus is full. You've been added to priority queue"

---

### Test 9: Priority Queue - Position Tracking

**Objective:** Verify queue position updates correctly

**Steps:**
1. Have 3 passengers waiting (P1, P2, P3)
2. Bus becomes full
3. All join queue in order
4. P1 boards (leaves queue)
5. Check P2 and P3 positions

**Expected Results:**
- Initial: P1=1, P2=2, P3=3
- After P1 leaves: P2=1, P3=2
- Queue length updates for all passengers
- FIFO order maintained

---

### Test 10: Priority Queue - Leave Queue

**Objective:** Verify passenger can leave priority queue

**Steps:**
1. Join priority queue as passenger
2. Click button to leave queue
3. Observe updates

**Expected Results:**
- Queue section disappears
- WebSocket event `leave_priority_queue` is sent
- Queue length updates for remaining passengers

---

### Test 11: Bus Seat Update Broadcast

**Objective:** Verify seat updates broadcast to all passengers

**Steps:**
1. Have 2 passengers tracking same bus
2. Driver updates seat count
3. Observe both passenger views

**Expected Results:**
- Both passengers see update simultaneously
- Seat counts match exactly
- Updates happen within 1 second

---

### Test 12: Multiple Buses - Seat Tracking

**Objective:** Verify seat tracking works with multiple buses

**Steps:**
1. Start 2 drivers on same route (BUS-001, BUS-002)
2. Set different seat counts (BUS-001: 20, BUS-002: 35)
3. Passenger selects stop
4. Observe passenger view

**Expected Results:**
- Passenger sees seat info for closest bus
- Seat counts are different for each bus
- No cross-contamination of data

---

### Test 13: Full Bus Notification

**Objective:** Verify notification sent when bus becomes full

**Steps:**
1. Set occupied seats to 47
2. Click "+" to reach 48
3. Observe notifications

**Expected Results:**
- Driver sees notification: "Bus marked as FULL"
- Passengers see notification: "Bus BUS-001 is now full"
- WebSocket event `bus_full_notification` received

---

### Test 14: Bus Number in Passenger View

**Objective:** Verify bus number displays correctly for passengers

**Steps:**
1. Driver sets bus number to "BUS-001"
2. Passenger tracks bus
3. Check passenger view

**Expected Results:**
- Bus number "BUS-001" displayed prominently
- Bus number in seat availability section
- Helps passenger identify correct bus

---

### Test 15: WebSocket Reconnection

**Objective:** Verify seat data persists after WebSocket reconnect

**Steps:**
1. Set occupied seats to 30
2. Disconnect WebSocket
3. Reconnect
4. Check seat count

**Expected Results:**
- Seat count still shows 30
- Data persists on server
- No data loss during reconnection

---

## Performance Tests

### P1: Real-time Update Latency
**Metric:** Time from driver seat update to passenger view update  
**Target:** < 500ms

### P2: Concurrent Seat Updates
**Metric:** System handles 10 simultaneous seat updates  
**Target:** All updates processed successfully

### P3: Priority Queue Scalability
**Metric:** Queue handles 100+ passengers  
**Target:** Position updates within 1 second

---

## Manual Testing Checklist

- [ ] Test 1: Driver Bus Number Selection
- [ ] Test 2: Manual Seat Counter - Increment
- [ ] Test 3: Manual Seat Counter - Decrement
- [ ] Test 4: Reset Seat Counter
- [ ] Test 5: Automatic Bus Full Detection
- [ ] Test 6: Waiting Passenger Count Display
- [ ] Test 7: Passenger Seat Availability Display
- [ ] Test 8: Priority Queue - Auto Join
- [ ] Test 9: Priority Queue - Position Tracking
- [ ] Test 10: Priority Queue - Leave Queue
- [ ] Test 11: Bus Seat Update Broadcast
- [ ] Test 12: Multiple Buses - Seat Tracking
- [ ] Test 13: Full Bus Notification
- [ ] Test 14: Bus Number in Passenger View
- [ ] Test 15: WebSocket Reconnection
- [ ] P1: Real-time Update Latency
- [ ] P2: Concurrent Seat Updates
- [ ] P3: Priority Queue Scalability

---

## Automated Test Script (Example)

```python
# Example using socketio client library
from socketio import Client

def test_seat_update():
    sio = Client()
    sio.connect('http://localhost:5000')
    
    # Authenticate as driver
    sio.emit('driver_authenticate', {
        'driver_id': 'DRIVER001',
        'password': 'admin123'
    })
    
    # Join route
    sio.emit('join_route', {
        'route_id': '48AC',
        'mode': 'bus',
        'bus_number': 'BUS-001'
    })
    
    # Update seat count
    sio.emit('update_seat_count', {
        'bus_id': 'test_bus',
        'route_id': '48AC',
        'occupied_seats': 30
    })
    
    # Wait for confirmation
    @sio.on('seat_count_updated')
    def on_update(data):
        assert data['occupied_seats'] == 30
        print("✓ Seat update test passed")
    
    sio.wait()
```

---

## Bug Tracking

| ID | Description | Status | Priority |
|----|-------------|--------|----------|
| - | - | - | - |

---

## Notes

1. All WebSocket events should be tested in both Chrome and Firefox
2. Test on both desktop and mobile devices
3. Verify data persists across page refreshes
4. Check console for any JavaScript errors
5. Monitor network tab for WebSocket messages
