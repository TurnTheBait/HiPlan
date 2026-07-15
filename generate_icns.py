import os
import shutil
import subprocess
from PIL import Image, ImageDraw


def draw_gantt_icon(size):
    # Create base image with transparent background for rounded squircle
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # macOS squircle radius ~ 22% of size
    radius = int(size * 0.22)
    margin = int(size * 0.04)
    rect_box = [margin, margin, size - margin, size - margin]

    # Dark background: sleek #0f172a with subtle border #334155
    draw.rounded_rectangle(
        rect_box,
        radius=radius,
        fill=(15, 23, 42, 255),
        outline=(51, 65, 85, 255),
        width=max(1, int(size * 0.012)),
    )

    # Load and composite HiWay logo if available
    logo_path = "hiway-logo.png"
    if os.path.exists(logo_path):
        try:
            logo_img = Image.open(logo_path).convert("RGBA")
            # Calculate target dimensions for the logo (~74% width)
            target_w = int(size * 0.74)
            target_h = int(size * 0.40)
            
            # Maintain aspect ratio
            w, h = logo_img.size
            ratio = min(target_w / w, target_h / h)
            new_w = max(1, int(w * ratio))
            new_h = max(1, int(h * ratio))
            
            logo_resized = logo_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
            
            x_offset = (size - new_w) // 2
            y_offset = int(size * 0.18)
            img.paste(logo_resized, (x_offset, y_offset), logo_resized)
        except Exception as e:
            print(f"Error loading logo for size {size}: {e}")

    # Draw vibrant mini Gantt timeline bars in the lower half
    grid_start_x = int(size * 0.16)
    grid_end_x = int(size * 0.84)
    
    bars = [
        (0.16, 0.52, 0.64, (59, 130, 246, 255)),  # Blue bar
        (0.38, 0.74, 0.75, (16, 185, 129, 255)),  # Green bar
        (0.50, 0.84, 0.86, (245, 158, 11, 255)),  # Amber bar
    ]

    for start_pct, end_pct, y_pct, color in bars:
        x1 = int(size * start_pct)
        x2 = int(size * end_pct)
        y1 = int(size * y_pct)
        y2 = y1 + max(2, int(size * 0.065))
        bar_radius = int((y2 - y1) * 0.4)
        draw.rounded_rectangle([x1, y1, x2, y2], radius=bar_radius, fill=color)

        # Inner highlight / progress fill
        draw.rounded_rectangle(
            [x1, y1, x1 + int((x2 - x1) * 0.65), y2],
            radius=bar_radius,
            fill=(255, 255, 255, 60),
        )

    return img


def main():
    iconset_dir = "GanttFlow.iconset"
    if os.path.exists(iconset_dir):
        shutil.rmtree(iconset_dir)
    os.makedirs(iconset_dir)

    sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]

    for size, name in sizes:
        img = draw_gantt_icon(size)
        img.save(os.path.join(iconset_dir, name))

    print("Generating AppIcon.icns using iconutil...")
    subprocess.run(
        ["iconutil", "-c", "icns", iconset_dir, "-o", "AppIcon.icns"],
        check=True,
    )
    print("AppIcon.icns created successfully!")

    # Copy to both app destinations
    destinations = [
        "/Users/davidegirolamo/Desktop/GanttFlow.app/Contents/Resources/applet.icns",
        "/Users/davidegirolamo/Desktop/GanttFlow.app/Contents/Resources/AppIcon.icns",
        "/Users/davidegirolamo/Programming/Gantt/GanttFlow.app/Contents/Resources/applet.icns",
        "/Users/davidegirolamo/Programming/Gantt/GanttFlow.app/Contents/Resources/AppIcon.icns",
    ]

    for dest in destinations:
        if os.path.exists(os.path.dirname(dest)):
            shutil.copy("AppIcon.icns", dest)
            print("Updated icon:", dest)

    # Clean up iconset
    shutil.rmtree(iconset_dir)
    print("Done!")


if __name__ == "__main__":
    main()
