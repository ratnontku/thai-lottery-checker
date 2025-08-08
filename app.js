document.getElementById("start-scan").addEventListener("click", function() {
    document.getElementById("reader").style.display = "block";
    startQRScanner();
});

function startQRScanner() {
    const html5QrCode = new Html5Qrcode("reader");

    Html5Qrcode.getCameras().then(devices => {
        if (devices && devices.length) {
            let cameraId = devices[0].id;
            html5QrCode.start(
                cameraId,
                {
                    fps: 10,
                    qrbox: 250
                },
                qrCodeMessage => {
                    document.getElementById("result").innerText = "QR Data: " + qrCodeMessage;
                    html5QrCode.stop(); // stop after first scan
                },
                errorMessage => {
                    // console.log(`QR Code no match: ${errorMessage}`);
                }
            ).catch(err => {
                console.error("Unable to start scanning", err);
            });
        }
    }).catch(err => {
        console.error("Camera error: ", err);
    });
}
