# 💺 Seat Management System - User Guide

## Overview
This guide explains how to use the seat management and priority queue features in the Bus Tracking System.

---

## 🚌 For Bus Drivers

### Step 1: Login
1. Open the bus tracking application
2. Click **"Bus Driver Mode"**
3. Enter your Driver ID and Password
4. Click **"Login"**

### Step 2: Select Route and Bus Number
1. Select your route from the dropdown
2. **Set your bus number** (e.g., 1, 2, 3)
   - This helps passengers know which bus is arriving
   - Important for routes with multiple buses
3. Click **"Set Bus Number"**

### Step 3: Start Sharing Location
1. Click **"Start Sharing Location"**
2. Your GPS location will be tracked automatically
3. The seat counter will appear

### Step 4: Managing Seats

#### Manual Seat Counter
- **Display shows:** "Occupied: 0 / 50"
- **To add passengers:** Click the **+** button
- **To remove passengers:** Click the **-** button

#### Capacity Warnings
- ⚠️ **Yellow warning** appears at 45+ seats
- 🔴 **Red alert** appears at 50/50 capacity
- Bus automatically hidden from passenger view when full

#### Viewing Waiting Passengers
The "Waiting Passengers" section shows:
- 👥 **Regular passengers** at each stop
- ⭐ **Priority passengers** (from previous full bus)

### Best Practices
✅ Update seat count when passengers board
✅ Check priority passengers at stops (⭐ icon)
✅ Give priority passengers first boarding
✅ Update seat count when passengers alight

---

## 👥 For Passengers

### Step 1: Select Route and Stop
1. Open the bus tracking application
2. Click **"Passenger Mode"**
3. Select your route
4. Select your stop from the dropdown

### Step 2: Track Bus
1. Click **"Track Bus"**
2. You'll see:
   - Real-time bus location on map
   - Distance to your stop
   - Estimated arrival time

### Step 3: Check Seat Availability

#### Seat Display
The seat availability card shows:
- 🚌 **Bus number** approaching
- **Available seats** (e.g., "15 Seats Available")
- **Occupied/Total** (e.g., "35 / 50 occupied")

#### Color Coding
- 🟢 **Green:** 16+ seats available (plenty of space)
- 🟠 **Orange:** 6-15 seats available (getting full)
- 🔴 **Red:** ≤5 seats available (nearly full)

### Step 4: Book Your Seat

#### If Seats Available
1. Click **"Book Seat"**
2. You'll see confirmation:
   - "Seat booked successfully!"
   - "Bus #2, Seat #15"

#### If Bus is Full
1. Click **"Book Seat"**
2. You'll be added to **Priority Queue**
3. Badge appears: "⭐ Priority Passenger"
4. Shows your queue position
5. You'll board the **next bus first**

### Understanding Priority Queue
- When a bus is full (50/50), new bookings go to priority queue
- Priority passengers get **first priority** on the next bus
- The system is **automatic** - no extra steps needed
- Your position in queue is displayed

---

## 📊 Example Scenarios

### Scenario 1: Normal Booking
```
Passenger Action:
1. Selects Stop #5
2. Clicks "Book Seat"
3. Bus has 23/50 seats occupied
4. ✅ Booking confirmed: "Bus #1, Seat #24"

Result:
- Seat count increases to 24/50
- All passengers see updated availability
- Bus continues accepting bookings
```

### Scenario 2: Bus Full - Priority Queue
```
Passenger Action:
1. Selects Stop #8
2. Clicks "Book Seat"
3. Bus #1 is full (50/50)
4. ⭐ Added to priority queue

Result:
- Message: "Bus full. You are priority for next bus."
- Queue position shown: #3
- Bus #2 driver sees 3 priority passengers at Stop #8
- Priority passengers board Bus #2 first
```

### Scenario 3: Multiple Buses
```
Route 48AC has 3 buses:
- Bus #1: 48/50 seats (nearly full) - shows orange
- Bus #2: 15/50 seats (plenty space) - shows green
- Bus #3: 50/50 seats (full) - hidden from view

Passengers see only Bus #1 and #2
Can book on either bus
Bus #3 passengers go to priority queue
```

---

## ⚙️ Technical Details

### Default Configuration
- **Total Seats:** 50 per bus (48 passenger + 2 crew)
- **Capacity Warning:** Triggers at 45 seats
- **Auto-Full Toggle:** Activates at 50 seats
- **Priority Queue:** FIFO (First In, First Out)

### Real-time Updates
All actions sync instantly via WebSocket:
- Driver seat updates → Broadcast to passengers
- Passenger bookings → Update driver's count
- Capacity changes → Update bus visibility
- Priority queue → Notify next bus driver

### Data Persistence
- Seat counts persist during active session
- Bus numbers remain assigned while sharing location
- Priority queue maintained until passengers board
- System resets when driver stops sharing

---

## 🔧 Troubleshooting

### Driver Issues

**Q: Bus number not saving**
- A: Ensure you clicked "Set Bus Number" button
- A: Check that you're authenticated and sharing location

**Q: Seat counter not updating**
- A: Check internet connection
- A: Verify you're sharing location
- A: Try clicking +/- buttons again

**Q: Can't see waiting passengers**
- A: Start sharing location first
- A: Passengers must be actively waiting at stops

### Passenger Issues

**Q: Can't see seat availability**
- A: Ensure bus is active and sharing location
- A: Check that you're tracking the bus
- A: Refresh the page if needed

**Q: Booking not working**
- A: Select your stop first
- A: Ensure bus is active
- A: Check internet connection

**Q: Why am I in priority queue?**
- A: Current bus is full (50/50 capacity)
- A: You'll board the next bus first
- A: No action needed - automatic process

---

## 📞 Support

For issues or questions:
1. Check this guide first
2. Review the main README.md
3. Open an issue on GitHub
4. Contact system administrator

---

## 🎯 Tips for Best Experience

### For Drivers
✅ Set bus number as soon as you start
✅ Update seat count regularly
✅ Watch for priority passenger alerts
✅ Keep app open while driving

### For Passengers
✅ Select your stop before tracking
✅ Book early to avoid priority queue
✅ Watch the color-coded seat indicator
✅ Trust the priority system if bus is full

---

**Version:** 1.0.0  
**Last Updated:** 2025-10-22  
**System:** Bus Tracking with Seat Management
