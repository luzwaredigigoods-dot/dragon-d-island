# Mengambil ikon TUJUAN sebuah shortcut (.lnk) langsung dari shell Windows, sebagai PNG.
# Dipakai untuk shortcut yang tidak menunjuk ke file (aplikasi Microsoft Store / MSIX), yang
# ikonnya tidak bisa dibaca dari file .ico atau .exe. Hasilnya tanpa panah shortcut.
#
# Masukan : satu permintaan per baris lewat stdin:  <id>|<path lengkap file .lnk>
#           atau <id>|::{GUID} untuk folder khusus Windows (This PC, Recycle Bin).
# Keluaran: satu baris JSON per permintaan: { id, png } atau { id, error }. Stdin ditutup = berhenti.

$ErrorActionPreference = 'Stop'

$stdout = [Console]::OpenStandardOutput()
function Emit($obj) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress) + "`n")
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

try {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class PulauIcon {
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    class ShellLink { }

    // Hanya dua metode pertama yang dipakai; urutannya harus sama dengan antarmuka aslinya.
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    interface IShellLinkW {
        [PreserveSig] int GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int cch, IntPtr findData, int flags);
        [PreserveSig] int GetIDList(out IntPtr pidl);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
    interface IPersistFile {
        [PreserveSig] int GetClassID(out Guid classId);
        [PreserveSig] int IsDirty();
        [PreserveSig] int Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, int mode);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SIZE { public int cx; public int cy; }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
    interface IShellItemImageFactory {
        [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr hbitmap);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BITMAPINFOHEADER {
        public int biSize; public int biWidth; public int biHeight; public short biPlanes; public short biBitCount;
        public int biCompression; public int biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter;
        public int biClrUsed; public int biClrImportant;
    }

    [DllImport("shell32.dll")]
    static extern int SHCreateItemFromIDList(IntPtr pidl, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHCreateItemFromParsingName(string path, IntPtr bindCtx, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);
    [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr p);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
    [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint start, uint lines, [Out] byte[] bits, ref BITMAPINFOHEADER info, uint usage);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);

    // Ikon tujuan shortcut sebagai PNG (base64).
    public static string LinkTargetPng(string lnkPath, int size) {
        object linkObj = new ShellLink();
        IntPtr pidl = IntPtr.Zero;
        IntPtr hbm = IntPtr.Zero;
        try {
            int hr = ((IPersistFile)linkObj).Load(lnkPath, 0);
            if (hr != 0) throw new Exception("Load 0x" + hr.ToString("X8"));
            hr = ((IShellLinkW)linkObj).GetIDList(out pidl);
            if (pidl == IntPtr.Zero) throw new Exception("shortcut tanpa tujuan (0x" + hr.ToString("X8") + ")");
            Guid iid = typeof(IShellItemImageFactory).GUID;
            IShellItemImageFactory factory;
            hr = SHCreateItemFromIDList(pidl, ref iid, out factory);
            if (hr != 0 || factory == null) throw new Exception("SHCreateItemFromIDList 0x" + hr.ToString("X8"));
            return FactoryPng(factory, size);
        } finally {
            if (pidl != IntPtr.Zero) CoTaskMemFree(pidl);
            Marshal.FinalReleaseComObject(linkObj);
        }
    }

    // Ikon item shell dari nama uraiannya, mis. "::{645FF040-5081-101B-9F08-00AA002F954E}" (Recycle Bin).
    // Untuk Recycle Bin, Windows memberi gambar kosong/berisi sesuai keadaannya saat ini.
    public static string ParsingPng(string name, int size) {
        Guid iid = typeof(IShellItemImageFactory).GUID;
        IShellItemImageFactory factory;
        int hr = SHCreateItemFromParsingName(name, IntPtr.Zero, ref iid, out factory);
        if (hr != 0 || factory == null) throw new Exception("SHCreateItemFromParsingName 0x" + hr.ToString("X8"));
        return FactoryPng(factory, size);
    }

    static string FactoryPng(IShellItemImageFactory factory, int size) {
        IntPtr hbm = IntPtr.Zero;
        try {
            SIZE sz = new SIZE();
            sz.cx = size; sz.cy = size;
            // 0x4 = hanya ikon (bukan pratinjau isi), 0x1 = boleh lebih besar dari yang diminta
            int hr = factory.GetImage(sz, 0x4 | 0x1, out hbm);
            if (hr != 0 || hbm == IntPtr.Zero) {
                hr = factory.GetImage(sz, 0x4, out hbm);
                if (hr != 0 || hbm == IntPtr.Zero) throw new Exception("GetImage 0x" + hr.ToString("X8"));
            }
            return ToPng(hbm, size);
        } finally {
            if (hbm != IntPtr.Zero) DeleteObject(hbm);
            Marshal.FinalReleaseComObject(factory);
        }
    }

    static string ToPng(IntPtr hbm, int hint) {
        IntPtr hdc = GetDC(IntPtr.Zero);
        try {
            // Tanya dulu ukuran gambar, lalu ambil pikselnya sebagai 32-bit dari atas ke bawah.
            BITMAPINFOHEADER info = new BITMAPINFOHEADER();
            info.biSize = Marshal.SizeOf(typeof(BITMAPINFOHEADER));
            if (GetDIBits(hdc, hbm, 0, 0, null, ref info, 0) == 0) throw new Exception("GetDIBits (ukuran) gagal");
            int w = info.biWidth, h = Math.Abs(info.biHeight);
            if (w <= 0 || h <= 0 || w > 1024 || h > 1024) throw new Exception("ukuran gambar aneh " + w + "x" + h);
            info = new BITMAPINFOHEADER();
            info.biSize = Marshal.SizeOf(typeof(BITMAPINFOHEADER));
            info.biWidth = w; info.biHeight = -h; info.biPlanes = 1; info.biBitCount = 32; info.biCompression = 0;
            byte[] px = new byte[w * h * 4];
            if (GetDIBits(hdc, hbm, 0, (uint)h, px, ref info, 0) == 0) throw new Exception("GetDIBits (piksel) gagal");
            bool anyAlpha = false;
            for (int i = 3; i < px.Length; i += 4) { if (px[i] != 0) { anyAlpha = true; break; } }
            // Ikon lama tanpa kanal alfa: anggap seluruhnya tidak tembus pandang.
            PixelFormat fmt = anyAlpha ? PixelFormat.Format32bppPArgb : PixelFormat.Format32bppRgb;
            using (Bitmap bmp = new Bitmap(w, h, fmt)) {
                BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, fmt);
                try {
                    for (int y = 0; y < h; y++) Marshal.Copy(px, y * w * 4, IntPtr.Add(data.Scan0, y * data.Stride), w * 4);
                } finally { bmp.UnlockBits(data); }
                using (MemoryStream ms = new MemoryStream()) {
                    bmp.Save(ms, ImageFormat.Png);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
        } finally {
            ReleaseDC(IntPtr.Zero, hdc);
        }
    }
}
"@
} catch {
    Emit @{ error = "addtype: $($_.Exception.Message)" }
    exit 1
}

Emit @{ ready = $true }

$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { exit 0 }   # aplikasi induk sudah tutup
    $sep = $line.IndexOf('|')
    if ($sep -lt 1) { continue }
    $id = $line.Substring(0, $sep)
    $path = $line.Substring($sep + 1)
    try {
        if ($path.StartsWith('::')) { $png = [PulauIcon]::ParsingPng($path, 96) }
        else { $png = [PulauIcon]::LinkTargetPng($path, 96) }
        Emit @{ id = $id; png = $png }
    } catch {
        $msg = "$($_.Exception.Message)"
        if ($_.Exception.InnerException) { $msg = "$($_.Exception.InnerException.Message)" }
        Emit @{ id = $id; error = $msg }
    }
}
