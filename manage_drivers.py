#!/usr/bin/env python3
"""
Driver Management Tool
Utility to manage bus driver accounts
"""

import csv
import hashlib
from datetime import datetime
import os

DRIVERS_FILE = 'bus_drivers.csv'

def hash_password(password):
    """Hash password using SHA256"""
    return hashlib.sha256(password.encode()).hexdigest()

def init_file():
    """Initialize drivers CSV if not exists"""
    if not os.path.isfile(DRIVERS_FILE):
        with open(DRIVERS_FILE, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['driver_id', 'password_hash', 'name', 'phone', 'license_number', 'created_at'])
        print(f"Created {DRIVERS_FILE}")

def list_drivers():
    """List all drivers"""
    if not os.path.isfile(DRIVERS_FILE):
        print("No drivers file found.")
        return
    
    with open(DRIVERS_FILE, 'r') as f:
        reader = csv.DictReader(f)
        drivers = list(reader)
    
    if not drivers:
        print("No drivers registered.")
        return
    
    print("\n" + "="*80)
    print(f"{'Driver ID':<15} {'Name':<25} {'Phone':<15} {'License':<20}")
    print("="*80)
    
    for driver in drivers:
        print(f"{driver['driver_id']:<15} {driver['name']:<25} {driver['phone']:<15} {driver['license_number']:<20}")
    
    print("="*80)
    print(f"Total drivers: {len(drivers)}\n")

def add_driver():
    """Add a new driver"""
    init_file()
    
    print("\n--- Add New Driver ---")
    driver_id = input("Driver ID: ").strip()
    
    if not driver_id:
        print("Driver ID cannot be empty.")
        return
    
    # Check if driver exists
    if os.path.isfile(DRIVERS_FILE):
        with open(DRIVERS_FILE, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row['driver_id'] == driver_id:
                    print(f"Driver ID '{driver_id}' already exists!")
                    return
    
    password = input("Password: ").strip()
    name = input("Full Name: ").strip()
    phone = input("Phone Number: ").strip()
    license = input("License Number: ").strip()
    
    if not all([password, name, phone, license]):
        print("All fields are required!")
        return
    
    password_hash = hash_password(password)
    
    with open(DRIVERS_FILE, 'a', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([
            driver_id,
            password_hash,
            name,
            phone,
            license,
            datetime.now().isoformat()
        ])
    
    print(f"\n✓ Driver '{driver_id}' added successfully!")

def delete_driver():
    """Delete a driver"""
    if not os.path.isfile(DRIVERS_FILE):
        print("No drivers file found.")
        return
    
    print("\n--- Delete Driver ---")
    driver_id = input("Driver ID to delete: ").strip()
    
    if not driver_id:
        print("Driver ID cannot be empty.")
        return
    
    with open(DRIVERS_FILE, 'r') as f:
        reader = list(csv.DictReader(f))
    
    found = False
    new_drivers = []
    
    for row in reader:
        if row['driver_id'] == driver_id:
            found = True
            print(f"Found: {row['name']} ({row['driver_id']})")
        else:
            new_drivers.append(row)
    
    if not found:
        print(f"Driver ID '{driver_id}' not found.")
        return
    
    confirm = input("Are you sure you want to delete this driver? (yes/no): ").strip().lower()
    
    if confirm == 'yes':
        with open(DRIVERS_FILE, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['driver_id', 'password_hash', 'name', 'phone', 'license_number', 'created_at'])
            writer.writeheader()
            writer.writerows(new_drivers)
        
        print(f"\n✓ Driver '{driver_id}' deleted successfully!")
    else:
        print("Deletion cancelled.")

def change_password():
    """Change driver password"""
    if not os.path.isfile(DRIVERS_FILE):
        print("No drivers file found.")
        return
    
    print("\n--- Change Password ---")
    driver_id = input("Driver ID: ").strip()
    
    if not driver_id:
        print("Driver ID cannot be empty.")
        return
    
    with open(DRIVERS_FILE, 'r') as f:
        reader = list(csv.DictReader(f))
    
    found = False
    for row in reader:
        if row['driver_id'] == driver_id:
            found = True
            print(f"Found: {row['name']} ({row['driver_id']})")
            
            new_password = input("New Password: ").strip()
            if not new_password:
                print("Password cannot be empty.")
                return
            
            row['password_hash'] = hash_password(new_password)
            break
    
    if not found:
        print(f"Driver ID '{driver_id}' not found.")
        return
    
    with open(DRIVERS_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['driver_id', 'password_hash', 'name', 'phone', 'license_number', 'created_at'])
        writer.writeheader()
        writer.writerows(reader)
    
    print(f"\n✓ Password changed successfully for '{driver_id}'!")

def main_menu():
    """Display main menu"""
    while True:
        print("\n" + "="*50)
        print("        BUS DRIVER MANAGEMENT TOOL")
        print("="*50)
        print("1. List all drivers")
        print("2. Add new driver")
        print("3. Delete driver")
        print("4. Change password")
        print("5. Exit")
        print("="*50)
        
        choice = input("\nEnter your choice (1-5): ").strip()
        
        if choice == '1':
            list_drivers()
        elif choice == '2':
            add_driver()
        elif choice == '3':
            delete_driver()
        elif choice == '4':
            change_password()
        elif choice == '5':
            print("\nGoodbye!")
            break
        else:
            print("Invalid choice. Please try again.")

if __name__ == '__main__':
    print("Bus Tracking System - Driver Management")
    print("---------------------------------------")
    
    # Initialize file if needed
    init_file()
    
    # Add default driver if file is empty
    if os.path.isfile(DRIVERS_FILE):
        with open(DRIVERS_FILE, 'r') as f:
            reader = list(csv.DictReader(f))
            if len(reader) == 0:
                print("\nNo drivers found. Creating default driver...")
                with open(DRIVERS_FILE, 'a', newline='') as f:
                    writer = csv.writer(f)
                    default_password_hash = hash_password('admin123')
                    writer.writerow([
                        'DRIVER001',
                        default_password_hash,
                        'Admin Driver',
                        '9876543210',
                        'TN01234567890',
                        datetime.now().isoformat()
                    ])
                print("✓ Default driver created:")
                print("  Driver ID: DRIVER001")
                print("  Password: admin123")
    
    main_menu()
