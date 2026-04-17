# Magic Board Debugging & Networking Guide

This document captures the exact steps and terminal commands I used under the hood to diagnose the networking and connectivity issues between the Vite Web App on the cell phone, the Windows laptop, and the Obsidian Vault.

## 1. Finding Network Identity

Before we could connect anything, we needed to know how the laptop identified itself on the local Wi-Fi.

### Extracting the Hostname
Command used:
```powershell
hostname
```
**Why:** This returns the netbios/mDNS name of the computer (in your case, `Alboro`). This allows modern devices (like iPhones or Macs) to route traffic to `alboro.local` without needing to memorize IP addresses.

### Extracting the IP Address
Command used:
```powershell
ipconfig
```
**Why:** When your cell phone failed to resolve `alboro.local`, we fell back to the hardcoded numeric IP address. Looking at the `IPv4 Address` under your Wi-Fi adapter showed us that your laptop was assigned **`192.168.1.69`** by your home router.

---

## 2. Diagnosing Inbound Connections (Firewalls & Ports)

After starting the Vite server (`npm run dev -- --host`), the phone could not reach it. 

### Attempting to punch through the Windows Firewall
Command used:
```powershell
New-NetFirewallRule -DisplayName "Vite Port 5173" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow
```
**Why:** Windows Defender Firewall blocks all inbound traffic from other devices by default. I tried to automatically create a rule to allow port `5173`. 
**Result:** `Access is denied.` This told me your terminal session was not running with Administrator privileges, meaning I had to guide you to manually check the Private/Public boxes for `node.exe` and `Obsidian.exe` in the Windows UI.

---

## 3. The "Aha!" Moment: Diagnosing the Obsidian Sync Failure

Once the phone could load the web app, it failed to sync. It sat in a spinning loop. To figure out why, I had to look at exactly what Obsidian was doing on the network layer.

### Inspecting Active Network Ports
Command used:
```powershell
netstat -ano | findstr 27124
```
**Why:** `netstat` lists all active TCP network connections and listening ports on the computer. `findstr 27124` filters the giant list to only show the port Obsidian uses.

**The Output I saw:**
```text
  TCP    0.0.0.0:27124          0.0.0.0:0              LISTENING       21716
  TCP    192.168.1.69:27124     192.168.1.66:40484     TIME_WAIT       0
```

### Breaking down the output:

1. **`0.0.0.0:27124 ... LISTENING`** 
   - This proved that our fix inside the Obsidian plugin settings worked! If the setting had remained broken, it would have said `127.0.0.1:27124`. Because it was `0.0.0.0`, it meant the plugin was successfully listening to the entire Wi-Fi network.

2. **`192.168.1.66:40484 ... TIME_WAIT`** 
   - **`192.168.1.69`** is your laptop.
   - **`192.168.1.66`** is an unknown device on your network (your cell phone!).
   - **`TIME_WAIT`** is a state indicating a TCP connection was established, but was abruptly closed or timed out.
   
This exact line is how I knew your phone was reaching the laptop. The firewall had passed the traffic, and the router correctly sent it to Obsidian. 

**Conclusion:** If the network is perfect, but the connection immediately hangs up (`TIME_WAIT`), it means the cell phone's Web Browser is intentionally terminating the connection before sending data. Why? Because `fetch()` on modern browsers will invisibly kill requests to self-signed HTTPS certificates. This allowed me to confidently tell you to navigate directly to the API URL and hit "Proceed to unsafe".

---

## 4. Helpful Future Commands

If your IP address ever shifts (because your router restarts), or the sync stops working, you can use these commands to debug:

* `ipconfig` -> Find out if your laptop's `.69` address changed.
* `ping 192.168.1.66` -> See if your laptop can reach your phone.
* `Test-NetConnection -ComputerName 127.0.0.1 -Port 27124` -> Verify if Obsidian is currently running and listening for notes.
